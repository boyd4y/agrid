import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import postgres from "postgres";
import { signInternalRequest } from "../src/internal-auth.js";
import { createTestHarness } from "wrangler";
import type { ExecutionReference, OutputPage } from "../src/contracts.js";

const connectionString = process.env.DATABASE_URL ?? "";
if (!connectionString || !new URL(connectionString).pathname.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");

function query(reference: ExecutionReference, after?: number) {
  return new URLSearchParams({ ...reference, ...(after === undefined ? {} : { after: String(after) }) }).toString();
}

async function eventually(check: () => Promise<boolean>) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail("Timed out waiting for durable receipt");
}

test("workerd per-session replay survives DO reconstruction; streaming and cancellation retain platform authorization", { timeout: 60000 }, async () => {
  const sql = postgres(connectionString, { max: 2, onnotice() {} });
  const scope = randomUUID();
  const reference = { executionId: randomUUID(), runId: randomUUID(), threadId: randomUUID() };
  const other = { executionId: randomUUID(), runId: randomUUID(), threadId: randomUUID() };
  const cookie = `fixture_session=${randomUUID()}`;
  const dispatchId = `fixture-${randomUUID()}`;
  const config = JSON.parse(await readFile(new URL("./fixture/wrangler.jsonc", import.meta.url), "utf8"));
  config.hyperdrive[0].localConnectionString = connectionString;
  const server = createTestHarness({ root: fileURLToPath(new URL("./fixture/", import.meta.url)), workers: [{ config }] });
  try {
    await sql`create table if not exists cf_coordination_fixture_internal(request_id text primary key,execution_id text not null,scope text not null)`;
    await sql`create table if not exists cf_coordination_fixture_runs(execution_id text primary key,run_id text not null,thread_id text not null,scope text not null,terminal boolean not null,status text not null,canceled boolean not null default false)`;
    await sql`create table if not exists cf_coordination_fixture_access(scope text primary key,cookie text not null,active boolean not null default true)`;
    await sql`create table if not exists cf_coordination_fixture_output(execution_id text not null,cursor integer not null,chunk jsonb not null,primary key(execution_id,cursor))`;
    await sql`create table if not exists cf_coordination_fixture_dispatch(id text primary key,scope text not null)`;
    await sql`create table if not exists cf_coordination_fixture_receipts(id text primary key,attempt integer not null)`;
    await sql`create table if not exists cf_coordination_fixture_cron(scheduled_time bigint not null,cron text not null,primary key(scheduled_time,cron))`;
    await sql`insert into cf_coordination_fixture_access(scope,cookie) values(${scope},${cookie})`;
    await sql`insert into cf_coordination_fixture_runs(execution_id,run_id,thread_id,scope,terminal,status) values
      (${reference.executionId},${reference.runId},${reference.threadId},${scope},true,'settled'),
      (${other.executionId},${other.runId},${other.threadId},${`other-${scope}`},false,'invoking')`;
    const chunks = [{ type: "start", messageId: "fixture-message" }, { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Hello" }, { type: "text-end", id: "t" }, { type: "finish", finishReason: "stop" }];
    for (const [index, chunk] of chunks.entries()) await sql`insert into cf_coordination_fixture_output(execution_id,cursor,chunk) values(${reference.executionId},${index+1},${sql.json(chunk)})`;
    await sql`insert into cf_coordination_fixture_dispatch(id,scope) values(${dispatchId},${scope})`;
    await server.listen();
    const headers = { cookie };
    const signed = await signInternalRequest(new Request("https://fixture.example/internal", { method: "POST", body: JSON.stringify({ executionId: reference.executionId }) }), {
      secret: "fixture-only-internal-signing-secret-not-production", audience: "fixture-control", requestId: `signed-${scope}`,
    });
    const signedBody = await signed.text();
    const signedHeaders = Object.fromEntries(signed.headers);
    const authenticated = await server.fetch("/internal", { method: "POST", headers: signedHeaders, body: signedBody });
    assert.equal(authenticated.status, 202);
    assert.deepEqual(await authenticated.json(), { accepted: true });
    const replayed = await server.fetch("/internal", { method: "POST", headers: signedHeaders, body: signedBody });
    assert.deepEqual(await replayed.json(), { accepted: false }, "signed replay retains one atomic durable receipt");
    assert.equal((await server.fetch("/internal", { method: "POST", headers: signedHeaders, body: JSON.stringify({ executionId: other.executionId }) })).status, 401, "body tampering is rejected");
    assert.equal((await server.fetch("/internal?changed=1", { method: "POST", headers: signedHeaders, body: signedBody })).status, 401, "route/query tampering is rejected");
    assert.equal((await server.fetch("/internal", { method: "POST", body: signedBody })).status, 401, "unsigned internal requests are rejected");
    await sql`insert into cf_coordination_fixture_access(scope,cookie) values(${`other-${scope}`},${cookie})`;
    const scopeProbe = await (await server.fetch(`/scope-probe?${query(reference)}&other=${encodeURIComponent(JSON.stringify(other))}`, { headers })).json();
    assert.deepEqual(scopeProbe, { invalidDenied: true, mismatchDenied: true }, "invalid credentials cannot reserve a DO; a bound DO rejects a different thread");
    await sql`delete from cf_coordination_fixture_access where scope=${`other-${scope}`}`;
    assert.equal((await server.fetch(`/stream?${query(reference)}`)).status, 403);
    assert.equal((await server.fetch(`/stream?${query(other)}`, { headers })).status, 403, "reference IDs are not authorization");
    assert.equal((await server.fetch(`/cancel?${query(reference)}`, { method: "POST" })).status, 403);
    const page = await (await server.fetch(`/replay?${query(reference)}`, { headers })).json() as OutputPage;
    assert.deepEqual(page.events.map(event => event.cursor), [1,2]);
    assert.equal((await server.fetch(`/evict?${query(reference)}`, { headers })).status, 204);
    const resumed = await (await server.fetch(`/replay?${query(reference, 2)}`, { headers })).json() as OutputPage;
    assert.deepEqual(resumed.events.map(event => event.cursor), [3,4], "DO memory is not the output authority");
    const stream = await server.fetch(`/stream?${query(reference)}`, { headers });
    assert.equal(stream.headers.get("x-vercel-ai-ui-message-stream"), "v1");
    const text = await stream.text();
    const data = text.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6));
    assert.deepEqual(data.slice(0,-1).map(value => JSON.parse(value)), chunks, "settled output spanning several pages is not truncated");
    assert.equal(data.at(-1), "[DONE]");
    const reconnect = await (await server.fetch(`/stream?${query(reference)}`, { headers: { ...headers, "last-event-id": "3" } })).text();
    assert(reconnect.includes('"type":"text-end"'));
    assert(!reconnect.includes('"type":"text-delta"'), "cursor prevents duplicate output on reconnect");
    assert.equal((await server.fetch(`/stream?${query(reference)}&after=-1`, { headers })).status, 400);

    await sql`update cf_coordination_fixture_runs set terminal=false,status='invoking' where execution_id=${reference.executionId}`;
    const live = await server.fetch(`/stream?${query(reference,5)}`, { headers });
    await live.body?.cancel();
    const [beforeCancel] = await sql`select canceled from cf_coordination_fixture_runs where execution_id=${reference.executionId}`;
    assert.equal(beforeCancel.canceled, false, "disconnect does not cancel execution");
    assert.equal((await server.fetch(`/cancel?${query(reference)}`, { method: "POST", headers })).status, 204);
    const [canceled] = await sql`select canceled from cf_coordination_fixture_runs where execution_id=${reference.executionId}`;
    assert.equal(canceled.canceled, true, "explicit cancellation commits before acknowledgment");
    const revocable = await server.fetch(`/stream?${query(reference,5)}`, { headers });
    await sql`update cf_coordination_fixture_access set active=false where scope=${scope}`;
    const revoked = await revocable.text();
    assert(revoked.includes('"type":"error"'), "active subscription rechecks revoked access");
    assert(!revoked.includes("fixture_session="), "stream failures redact credentials/internal errors");

    assert.equal((await server.fetch("/publish", { method: "POST", body: JSON.stringify({ id: dispatchId, body: { actorId: "spoofed", fullTurnMustNotRunHere: true } }) })).status, 202);
    await eventually(async () => {
      const [receipt] = await sql`select attempt from cf_coordination_fixture_receipts where id=${dispatchId}`;
      return receipt?.attempt === 2;
    });
    assert.equal((await server.fetch("/publish", { method: "POST", body: JSON.stringify({ id: dispatchId, body: {} }) })).status, 202);
    await new Promise(resolve => setTimeout(resolve, 1300));
    const [receipts] = await sql`select count(*)::int as count from cf_coordination_fixture_receipts where id=${dispatchId}`;
    assert.equal(receipts.count, 1, "duplicate queue receipt does not reaccept execution");
    const [unfinished] = await sql`select terminal,status from cf_coordination_fixture_runs where execution_id=${reference.executionId}`;
    assert.equal(unfinished.terminal, false);
    assert.equal(unfinished.status, "invoking", "queue ack does not wait for the complete agent turn");
    const scheduledTime = Date.now();
    assert.equal((await server.fetch(`/schedule?time=${scheduledTime}`)).status, 204);
    const [cron] = await sql`select cron from cf_coordination_fixture_cron where scheduled_time=${scheduledTime}`;
    assert.equal(cron.cron, "* * * * *");
    await sql`delete from cf_coordination_fixture_cron where scheduled_time=${scheduledTime}`;
  } finally {
    await server.close();
    await sql`delete from cf_coordination_fixture_internal where scope=${scope}`;
    await sql`delete from cf_coordination_fixture_output where execution_id in (${reference.executionId},${other.executionId})`;
    await sql`delete from cf_coordination_fixture_runs where execution_id in (${reference.executionId},${other.executionId})`;
    await sql`delete from cf_coordination_fixture_access where scope in (${scope},${`other-${scope}`})`;
    await sql`delete from cf_coordination_fixture_receipts where id=${dispatchId}`;
    await sql`delete from cf_coordination_fixture_dispatch where id=${dispatchId}`;
    await sql.end();
  }
});
