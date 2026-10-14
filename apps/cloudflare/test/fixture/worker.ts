import postgres from "postgres";
import { InternalAuthenticationError, verifyInternalRequest } from "../../src/internal-auth.js";
import { parseQueueMessage } from "@tabdo/queue";
import { createCloudflarePublisher } from "@tabdo/queue/adapters/cloudflare";
import { createSessionCoordinator } from "../../src/coordinator.js";
import { createCloudflareTriggers } from "../../src/triggers.js";
import { CoordinationError, parseExecutionReference, type AccessCredentials, type ExecutionReference, type OutputPage } from "../../src/contracts.js";

// Fixture callbacks use isolated PG tables. They are not a second product repository or a deployable app.
function sqlFor(env: CoordinationTestEnv) {
  return postgres(env.HYPERDRIVE.connectionString, { max: 1, connect_timeout: 5, idle_timeout: 1 });
}

async function authorizedRow(env: CoordinationTestEnv, reference: ExecutionReference, credentials: AccessCredentials) {
  const sql = sqlFor(env);
  try {
    const cookie = credentials.cookie ?? "";
    const [row] = await sql`select r.* from cf_coordination_fixture_runs r join cf_coordination_fixture_access a on a.scope=r.scope
      where r.execution_id=${reference.executionId} and r.run_id=${reference.runId} and r.thread_id=${reference.threadId}
      and a.cookie=${cookie} and a.active=true`;
    if (!row) throw new CoordinationError("Forbidden", 403);
    return row;
  } finally { await sql.end(); }
}

const BaseCoordinator = createSessionCoordinator<CoordinationTestEnv>((env) => ({
  async readOutput({ reference, after, limit, credentials }) {
    await authorizedRow(env, reference, credentials);
    const sql = sqlFor(env);
    try {
      const [row] = await sql`select terminal,status from cf_coordination_fixture_runs where execution_id=${reference.executionId}`;
      const events = await sql`select cursor,chunk from cf_coordination_fixture_output where execution_id=${reference.executionId} and cursor>${after} order by cursor limit ${limit}`;
      return { events: events.map(event => ({ cursor: Number(event.cursor), chunk: event.chunk })), terminal: row.terminal, status: row.status } as OutputPage;
    } finally { await sql.end(); }
  },
  async cancel({ reference, credentials }) {
    await authorizedRow(env, reference, credentials);
    const sql = sqlFor(env);
    try { await sql`update cf_coordination_fixture_runs set canceled=true where execution_id=${reference.executionId}`; }
    finally { await sql.end(); }
  },
}), { pageSize: 2, pollIntervalMs: 25 });

export class FixtureSessionCoordinator extends BaseCoordinator {
  evict(): void { this.ctx.abort("Test reconstruction after eviction"); }
}

const triggers = createCloudflareTriggers<CoordinationTestEnv>((env) => ({
  async accept(message, attempt) {
    const sql = sqlFor(env);
    try {
      const [allowed] = await sql`select id from cf_coordination_fixture_dispatch where id=${message.id}`;
      if (!allowed) throw new Error("No durable platform dispatch for this message");
      // A transient error before commit must retry. Duplicate deliveries after commit retain one receipt.
      if (attempt === 1) throw new Error("Fixture acceptance temporarily unavailable");
      await sql`insert into cf_coordination_fixture_receipts(id,attempt) values(${message.id},${attempt}) on conflict(id) do nothing`;
    } finally { await sql.end(); }
  },
  async wakeSchedules(input) {
    const sql = sqlFor(env);
    try { await sql`insert into cf_coordination_fixture_cron(scheduled_time,cron) values(${input.scheduledTime},${input.cron}) on conflict do nothing`; }
    finally { await sql.end(); }
  },
}));

export default {
  ...triggers,
  async fetch(request: Request, env: CoordinationTestEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/internal") {
      try {
        const verified = await verifyInternalRequest(request, { secret: env.INTERNAL_SECRET, audience: "fixture-control" });
        const body: unknown = JSON.parse(verified.body);
        if (!body || typeof body !== "object" || Object.keys(body).length !== 1 || !("executionId" in body) || typeof body.executionId !== "string") throw new CoordinationError("Invalid reference", 400);
        const executionId = body.executionId;
        const sql = sqlFor(env);
        try {
          const accepted = await sql.begin(async tx => {
            const [known] = await tx`select scope from cf_coordination_fixture_runs where execution_id=${executionId}`;
            if (!known) throw new CoordinationError("Unknown execution", 404);
            const inserted = await tx`insert into cf_coordination_fixture_internal(request_id,execution_id,scope) values(${verified.requestId},${executionId},${known.scope}) on conflict(request_id) do nothing returning request_id`;
            const [receipt] = await tx`select execution_id from cf_coordination_fixture_internal where request_id=${verified.requestId}`;
            if (receipt.execution_id !== executionId) throw new CoordinationError("Request id conflict", 409);
            return inserted.length > 0;
          });
          return Response.json({ accepted }, { status: 202 });
        } finally { await sql.end(); }
      } catch (error) {
        return Response.json({ error: "Internal request rejected" }, { status: error instanceof CoordinationError || error instanceof InternalAuthenticationError ? error.status : 400 });
      }
    }
    if (url.pathname === "/publish") {
      const message = parseQueueMessage(await request.json());
      await createCloudflarePublisher(env.JOBS).publish(message);
      return new Response(null, { status: 202 });
    }
    if (url.pathname === "/schedule") {
      await triggers.scheduled({ scheduledTime: Number(url.searchParams.get("time")), cron: "* * * * *", noRetry() {} }, env);
      return new Response(null, { status: 204 });
    }
    const reference = parseExecutionReference({ executionId: url.searchParams.get("executionId"), runId: url.searchParams.get("runId"), threadId: url.searchParams.get("threadId") });
    const credentials = { cookie: request.headers.get("cookie") ?? undefined, authorization: request.headers.get("authorization") ?? undefined };
    // IDs in query/body never authorize access, including internal fixture eviction.
    try { await authorizedRow(env, reference, credentials); }
    catch { return new Response(null, { status: 403 }); }
    const coordinator = env.SESSIONS.getByName(`thread:${reference.threadId}`);
    if (url.pathname === "/scope-probe") {
      const otherReference = parseExecutionReference(JSON.parse(url.searchParams.get("other") ?? "null"));
      await authorizedRow(env, otherReference, credentials);
      const probe = env.SESSIONS.getByName(`probe:${reference.threadId}`);
      let invalidDenied = false;
      let mismatchDenied = false;
      try { await probe.replay({ reference, after: 0, limit: 2, credentials: {} }); }
      catch { invalidDenied = true; }
      await probe.replay({ reference: otherReference, after: 0, limit: 2, credentials });
      try { await probe.replay({ reference, after: 0, limit: 2, credentials }); }
      catch { mismatchDenied = true; }
      return Response.json({ invalidDenied, mismatchDenied });
    }
    if (url.pathname === "/cancel") {
      await coordinator.cancel({ reference, credentials });
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/evict") {
      try { await coordinator.evict(); } catch { /* abort intentionally drops the RPC */ }
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/replay") {
      return Response.json(await coordinator.replay({ reference, after: Number(url.searchParams.get("after") ?? 0), limit: 2, credentials }));
    }
    if (url.pathname === "/stream") return coordinator.fetch(request);
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<CoordinationTestEnv>;
