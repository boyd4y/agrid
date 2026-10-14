import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { eq, sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { db, client } from "../../src/db/index.js";
import { organization, tables, columns, rows, automations, automationEvents, automationOutbox, automationRuns, automationStepReceipts } from "../../src/db/schema.js";
import { addRow, updateCell } from "../../src/commands/index.js";
import { updateAutomation, deleteAutomation, replayAutomationRun } from "../../src/automation/crud.js";
import { claimExecution, executeNext, recordFailure, PermanentError, FenceLostError } from "../../src/automation/execution.js";
import { startWorker } from "../../src/queue/workers.js";
import { redisOptions, prefix } from "../../src/queue/config.js";
import { createQueue, closeQueue, jobId, type AutomationJob } from "../../src/queue/queues.js";
import { createPublishedReconciler } from "../../src/queue/reconcile.js";
import { createRelay } from "../../src/queue/relay.js";
import { acquireRowLease } from "../../src/queue/lease.js";

assert.ok(new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_queue_test"), "Use an isolated *_queue_test database");
assert.ok(prefix.startsWith("agrid-queue-test"), "Use a dedicated test Redis prefix");
const redis = new Redis({ ...redisOptions(false), connectionName: "test-raw" }); redis.on("error", () => {});
const queue = createQueue();
const relay = createRelay();
const runtimes: ReturnType<typeof startWorker>[] = [];
async function eventually(check: () => Promise<boolean>, timeout = 15000) {
  const start = Date.now();
  while (!await check()) {
    if (Date.now() - start > timeout) throw new Error("Timed out waiting for execution");
    await new Promise((r) => setTimeout(r, 25));
  }
}
async function fixture(options: { enabled?: boolean; trigger?: "row_created" | "field_changed"; condition?: string; value?: string; twoSteps?: boolean } = {}) {
  const org = `test-${randomUUID()}`;
  await db.insert(organization).values({ id: org, name: "queue test", slug: org });
  const [table] = await db.insert(tables).values({ organizationId: org, name: "queue test" }).returning();
  const [input, output] = await db.insert(columns).values([
    { tableId: table.id, name: "Input", type: "text" }, { tableId: table.id, name: "Output", type: "text" },
  ]).returning();
  const [rule] = await db.insert(automations).values({ tableId: table.id, organizationId: org, source: { kind: "table", tableId: table.id }, name: "Rule", enabled: options.enabled ?? true,
    trigger: options.trigger === "field_changed" ? { type: "field_changed", columnId: input.id } : { type: "row_created" },
    conditions: options.condition ? [{ id: "c", columnId: input.id, op: "eq", value: options.condition }] : [],
    actions: [{ type: "update_field", columnId: output.id, value: "done" },
      ...(options.twoSteps ? [{ type: "update_field", columnId: output.id, value: "step two" }] : [])],
  }).returning();
  const row = await addRow({ tableId: table.id, organizationId: org, cells: { [input.id]: options.value ?? "initial" } });
  const [event] = await db.select().from(automationEvents).where(eq(automationEvents.rowId, row.id));
  const [delivery] = event ? await db.select().from(automationOutbox).where(eq(automationOutbox.eventId, event.id)) : [];
  const job = delivery ? { data: delivery.payload } : undefined;
  return { org, table, input, output, rule, row, job, event, delivery };

}
async function eventState(id: string) {
  const [event] = await db.select().from(automationEvents).where(eq(automationEvents.id, id)); return event;
}
async function runDirect(job: AutomationJob) {
  const fence = await claimExecution(job.eventId, job.generation);
  if (fence !== undefined) {
    try { while (await executeNext(job.eventId, fence) === "continue") {} }
    catch (error) { if (!(error instanceof PermanentError)) throw error; await recordFailure(job.eventId, error, true, fence, job.generation); }
  }
}
before(async () => {
  if (redis.status !== "ready") await new Promise<void>((resolve) => redis.once("ready", resolve));
  const keys = await redis.keys(`${prefix}:*`); if (keys.length) await redis.del(...keys);
  await db.execute(sql`TRUNCATE automation_events, automation_runs, organization CASCADE`);
});
after(async () => {
  try { for (const runtime of runtimes) await runtime.close(); }
  finally { await relay.close(); await closeQueue(queue); redis.disconnect(); await client.end(); }
});

test("only matched plans create outbox records; business data and delivery commit together", async () => {
  const enabled = await fixture(); assert.ok(enabled.job);
  assert.equal((await eventState(enabled.job.data.eventId)).status, "matched");
  assert.equal((enabled.event.snapshot.row as { cells: Record<string, string> }).cells[enabled.input.id], "initial");
  const noRules = await fixture({ enabled: false }); assert.equal(noRules.job, undefined);
  await db.delete(automations).where(eq(automations.id, noRules.rule.id));
  const plain = await addRow({ tableId: noRules.table.id, organizationId: noRules.org });
  assert.equal((await db.select().from(automationEvents).where(eq(automationEvents.rowId, plain.id))).length, 0);
  assert.equal((await fixture({ trigger: "field_changed" })).job, undefined);
  assert.equal((await fixture({ condition: "different" })).job, undefined);
  const counts = await db.select().from(automationOutbox);
  const updated = await updateCell({ rowId: enabled.row.id, columnId: enabled.input.id, value: "initial", organizationId: enabled.org });
  assert.equal(updated.version, 1);
  assert.deepEqual(await db.select().from(automationOutbox), counts, "Same-value writes do not enqueue");
  await assert.rejects(updateCell({ rowId: enabled.row.id, columnId: enabled.input.id, value: "bad", expectedVersion: 999, organizationId: enabled.org }), /版本冲突/);
  assert.deepEqual(await db.select().from(automationOutbox), counts, "Rolled-back mutations do not enqueue");
  await runDirect(enabled.job.data);
});

test("outbox insertion failure rolls back the business change and matched plans", async () => {
  const f = await fixture({ trigger: "field_changed" });
  await db.execute(sql`ALTER TABLE automation_outbox ADD CONSTRAINT queue_test_reject_delivery CHECK (status <> 'pending') NOT VALID`);
  try {
    await assert.rejects(updateCell({ rowId: f.row.id, columnId: f.input.id, value: "must rollback", organizationId: f.org }));
    const [row] = await db.select().from(rows).where(eq(rows.id, f.row.id));
    assert.equal(row.cells[f.input.id], "initial"); assert.equal(row.version, 1);
    assert.equal((await db.select().from(automationEvents).where(eq(automationEvents.rowId, row.id))).length, 0);
    assert.equal((await db.select().from(automationRuns).where(eq(automationRuns.rowId, row.id))).length, 0);
  } finally { await db.execute(sql`ALTER TABLE automation_outbox DROP CONSTRAINT queue_test_reject_delivery`); }
});

test("field changes are matched before enqueue; unrelated columns do not enqueue", async () => {
  const f = await fixture({ trigger: "field_changed" }); assert.equal(f.job, undefined);
  await updateCell({ rowId: f.row.id, columnId: f.output.id, value: "unrelated", organizationId: f.org });
  const jobsBefore = await db.select().from(automationOutbox);
  await updateCell({ rowId: f.row.id, columnId: f.input.id, value: "changed", organizationId: f.org });
  const jobsAfter = await db.select().from(automationOutbox); assert.equal(jobsAfter.length, jobsBefore.length + 1);
  await runDirect(jobsAfter.find((d) => !jobsBefore.some((before) => before.id === d.id))!.payload);
});

test("matched plans preserve trigger snapshots and rule versions before worker execution", async () => {
  const f = await fixture({ condition: "initial" }); assert.ok(f.job);
  await updateAutomation({ automationId: f.rule.id, organizationId: f.org,
    actions: [{ type: "update_field", columnId: f.output.id, value: "edited rule" }] });
  await runDirect(f.job.data);
  const [row] = await db.select().from(rows).where(eq(rows.id, f.row.id)); assert.equal(row.cells[f.output.id], "done");
  const [run] = await db.select().from(automationRuns).where(eq(automationRuns.eventId, f.job.data.eventId)); assert.equal(run.ruleVersion, 1);
});

test("new input supersedes old jobs; completed receipts and fences protect repeated writes", async () => {
  const f = await fixture(); assert.ok(f.job);
  await updateCell({ rowId: f.row.id, columnId: f.input.id, value: "new", organizationId: f.org });
  await runDirect(f.job.data); assert.equal((await eventState(f.job.data.eventId)).status, "superseded");
  const other = await fixture(); assert.ok(other.job);
  const old = (await claimExecution(other.job.data.eventId))!; const current = (await claimExecution(other.job.data.eventId))!;
  await assert.rejects(executeNext(other.job.data.eventId, old), FenceLostError);
  await executeNext(other.job.data.eventId, current);
  const takeover = (await claimExecution(other.job.data.eventId))!; await executeNext(other.job.data.eventId, takeover);
  await runDirect(other.job.data);
  const [row] = await db.select().from(rows).where(eq(rows.id, other.row.id)); assert.equal(row.version, 2);
});

test("disabled/deleted resources cancel queued plans and tenants remain isolated", async () => {
  const f = await fixture(); assert.ok(f.job);
  await deleteAutomation({ automationId: f.rule.id, organizationId: f.org }); await runDirect(f.job.data);
  const [run] = await db.select().from(automationRuns).where(eq(automationRuns.eventId, f.job.data.eventId)); assert.equal(run.status, "cancelled");
  await assert.rejects(updateCell({ rowId: f.row.id, columnId: f.output.id, value: "attack", organizationId: "other" }), /工作区/);
  const gone = await fixture(); assert.ok(gone.job); await db.delete(tables).where(eq(tables.id, gone.table.id));
  await runDirect(gone.job.data); assert.equal((await eventState(gone.job.data.eventId)).status, "cancelled");
  const noColumn = await fixture(); assert.ok(noColumn.job); await db.delete(columns).where(eq(columns.id, noColumn.output.id));
  await runDirect(noColumn.job.data); assert.equal((await eventState(noColumn.job.data.eventId)).status, "failed");
  const revoked = await fixture(); assert.ok(revoked.job); await db.update(automationEvents).set({ snapshot: { ...revoked.event.snapshot, actorId: "revoked-member" } }).where(eq(automationEvents.id, revoked.event.id));
  await runDirect(revoked.job.data); assert.equal((await eventState(revoked.job.data.eventId)).status, "cancelled");
});

test("row leases and tenant concurrency are shared across clients", async () => {
  process.env.AUTOMATION_TENANT_CONCURRENCY = "1";
  const org = randomUUID(); const row = randomUUID(); const held = await acquireRowLease(redis, org, row); assert.ok(held);
  assert.equal(await acquireRowLease(redis, org, row), null); assert.equal(await acquireRowLease(redis, org, randomUUID()), null);
  await held.release(); const next = await acquireRowLease(redis, org, row); assert.ok(next); await next.release();
  delete process.env.AUTOMATION_TENANT_CONCURRENCY;
});

test("concurrent relays atomically claim different batches", async () => {
  const peer = createRelay();
  try {
    const fixtures = await Promise.all(Array.from({ length: 6 }, () => fixture()));
    const [a, b] = await Promise.all([relay.claim(3), peer.claim(3)]);
    assert.equal(a.length, 3); assert.equal(b.length, 3);
    assert.equal(new Set([...a, ...b].map((d) => d.id)).size, 6);
    const records = await db.select().from(automationOutbox).where(sql`status = 'publishing'`);
    assert.equal(records.length, 6); assert.ok(records.every((r) => r.claimToken && r.claimUntil));
    for (const f of fixtures) await runDirect(f.job!.data);
  } finally { await peer.close(); }
});

test("locked records are skipped; expired claims recover and stale owners cannot publish", async () => {
  const a = await fixture(); const b = await fixture();
  let claimed: Awaited<ReturnType<typeof relay.claim>> = [];
  await assert.rejects(db.transaction(async (tx) => {
    await tx.select().from(automationOutbox).where(eq(automationOutbox.id, a.delivery!.id)).for("update");
    claimed = await relay.claim(1);
    assert.equal(claimed[0].id, b.delivery!.id);
    throw new Error("rollback claimant test");
  }), /rollback claimant/);
  assert.equal((await db.select().from(automationOutbox).where(eq(automationOutbox.id, a.delivery!.id)))[0].status, "pending");
  const old = (await relay.claim(1))[0]; assert.equal(old.id, a.delivery!.id);
  await db.update(automationOutbox).set({ claimUntil: new Date(0) }).where(eq(automationOutbox.id, old.id));
  const next = (await relay.claim(1))[0]; assert.notEqual(next.claim_token, old.claim_token);
  assert.equal(await relay.publish(old), false, "An expired publisher cannot acknowledge or send a reclaimed record");
  const [owned] = await db.select().from(automationOutbox).where(eq(automationOutbox.id, next.id));
  assert.equal(owned.claimToken, next.claim_token);
  await runDirect(a.job!.data); await runDirect(b.job!.data);
});

test("crash after Redis accepts a job and before DB ack retries the same job ID", async () => {
  const f = await fixture(); const old = (await relay.claim(1))[0];
  const first = await queue.add("execute", old.payload, { jobId: jobId(old.payload.eventId, old.generation) });
  await db.update(automationOutbox).set({ claimUntil: new Date(0) }).where(eq(automationOutbox.id, old.id));
  const replacement = (await relay.claim(1))[0]; assert.equal(await relay.publish(replacement), true);
  assert.equal((await queue.getJobs(["wait"], 0, -1)).filter((j) => j.id === first.id).length, 1);
  assert.equal((await db.select().from(automationOutbox).where(eq(automationOutbox.id, f.delivery!.id)))[0].status, "published");
  await runDirect(f.job!.data);
});

test("multiple BullMQ workers consume directly; retry after action commit does not repeat effects", async () => {
  const f = await fixture(); assert.ok(f.job);
  let failOnce = true;
  for (let i = 0; i < 2; i++) {
    const runtime = startWorker({ afterAction: async (id) => {
      if (id === f.job!.data.eventId && failOnce) { failOnce = false; throw new Error("injected crash after action commit"); }
    } }); runtimes.push(runtime); await runtime.ready;
  }
  await relay.tick();
  await eventually(async () => Boolean((await eventState(f.job!.data.eventId))?.finishedAt));
  assert.equal((await eventState(f.job.data.eventId)).status, "completed");
  const [row] = await db.select().from(rows).where(eq(rows.id, f.row.id)); assert.equal(row.version, 2);
  const duplicate = await queue.add("duplicate", f.job.data, { jobId: `duplicate-${randomUUID()}` });
  await eventually(async () => await duplicate.getState() === "completed");
  const [same] = await db.select().from(rows).where(eq(rows.id, f.row.id)); assert.equal(same.version, 2);
});

test("published reconciler restores a missing Redis job without repeating committed steps", async () => {
  for (const runtime of runtimes) await runtime.worker.pause();
  const reconciler = createPublishedReconciler();
  const f = await fixture({ twoSteps: true }); assert.ok(f.job);
  try {
    // Commit one step before a transient retry, preserving the same generation and receipts.
    const fence = (await claimExecution(f.event.id))!;
    await executeNext(f.event.id, fence);
    await db.update(automationEvents).set({ status: "retrying" }).where(eq(automationEvents.id, f.event.id));
    const delivery = (await relay.claim(100)).find((d) => d.id === f.delivery!.id)!;
    assert.equal(await relay.publish(delivery), true);
    const id = jobId(f.event.id, f.event.generation);
    await (await queue.getJob(id))!.remove();
    await reconciler.tick();
    assert.equal((await db.select().from(automationOutbox).where(eq(automationOutbox.id, delivery.id)))[0].status, "published", "Grace protects recent publications");
    await db.update(automationOutbox).set({ publishedAt: new Date(0) }).where(eq(automationOutbox.id, delivery.id));
    await Promise.all([reconciler.tick(), reconciler.tick()]);
    const [reset] = await db.select().from(automationOutbox).where(eq(automationOutbox.id, delivery.id));
    assert.equal(reset.status, "pending"); assert.equal(reset.generation, delivery.generation);
    assert.equal(reset.publishedAt, null); assert.equal(reset.claimToken, null); assert.equal(reset.claimUntil, null);
    const replacement = (await relay.claim(100)).find((d) => d.id === delivery.id)!;
    assert.equal(await relay.publish(replacement), true);
    assert.ok(await queue.getJob(id));
    await runDirect(replacement.payload); await runDirect(replacement.payload);
    assert.equal((await eventState(f.event.id)).status, "completed");
    const [row] = await db.select().from(rows).where(eq(rows.id, f.row.id));
    assert.equal(row.version, 3); assert.equal(row.cells[f.output.id], "step two");
    const [run] = await db.select().from(automationRuns).where(eq(automationRuns.eventId, f.event.id));
    assert.equal((await db.select().from(automationStepReceipts).where(eq(automationStepReceipts.runId, run.id))).length, 2);
  } finally { await reconciler.close(); }
});

test("published reconciler skips waiting input, running fences, unknown native runs, live row leases and existing jobs", async () => {
  for (const runtime of runtimes) await runtime.worker.pause();
  const reconciler = createPublishedReconciler();
  const fixtures = await Promise.all(Array.from({ length: 5 }, () => fixture()));
  const deliveries = await relay.claim(100);
  let lease: Awaited<ReturnType<typeof acquireRowLease>> = null;
  try {
    for (const f of fixtures) {
      await relay.publish(deliveries.find((d) => d.id === f.delivery!.id)!);
      await db.update(automationOutbox).set({ publishedAt: new Date(0) }).where(eq(automationOutbox.id, f.delivery!.id));
    }
    for (const f of fixtures.slice(0, 3)) await (await queue.getJob(jobId(f.event.id)))!.remove();
    await db.update(automationEvents).set({ status: "waiting_input" }).where(eq(automationEvents.id, fixtures[0].event.id));
    await claimExecution(fixtures[1].event.id);
    lease = await acquireRowLease(redis, fixtures[2].org, fixtures[2].row.id); assert.ok(lease);
    await db.update(automationRuns).set({ status: "unknown" }).where(eq(automationRuns.eventId, fixtures[4].event.id));
    await (await queue.getJob(jobId(fixtures[4].event.id)))!.remove();
    await reconciler.tick();
    for (const f of fixtures) {
      const [delivery] = await db.select().from(automationOutbox).where(eq(automationOutbox.id, f.delivery!.id));
      assert.equal(delivery.status, "published");
    }
  } finally {
    await lease?.release(); await reconciler.close();
    for (const f of fixtures) {
      await db.update(automationRuns).set({ status: "queued" }).where(eq(automationRuns.eventId, f.event.id));
      await db.update(automationEvents).set({ status: "matched" }).where(eq(automationEvents.id, f.event.id));
      await runDirect(f.job!.data);
    }
  }
});

test("retry exhaustion and outbox-backed manual replay resume only unfinished steps", async () => {
  for (const runtime of runtimes) await runtime.worker.pause();
  const f = await fixture({ twoSteps: true }); assert.ok(f.job);
  let blocked = false;
  const runtime = startWorker({ afterAction: async (id) => { if (id === f.job!.data.eventId) blocked = true; },
    beforeAction: async (id) => { if (id === f.job!.data.eventId && blocked) throw new Error("injected transient failure"); } });
  // Start paused until test-specific retry options are installed.
  await runtime.worker.pause(); await runtime.ready; runtimes.push(runtime);
  await queue.add("fault", f.job.data, { jobId: jobId(f.job.data.eventId), attempts: 2, backoff: { type: "fixed", delay: 20 } });
  runtime.worker.resume();
  await eventually(async () => (await eventState(f.job!.data.eventId))?.status === "failed");
  const [failed] = await db.select().from(automationRuns).where(eq(automationRuns.eventId, f.job.data.eventId)); assert.equal(failed.nextStep, 1);
  await assert.rejects(replayAutomationRun(failed.id, "wrong tenant"), /运行不存在或尚在执行/);
  await runtime.worker.pause(); blocked = false;
  await replayAutomationRun(failed.id, f.org);
  await relay.tick();
  const replayWorker = startWorker(); runtimes.push(replayWorker); await replayWorker.ready;
  await eventually(async () => { await relay.tick(); return (await eventState(f.job!.data.eventId)).status === "completed"; });
  const [row] = await db.select().from(rows).where(eq(rows.id, f.row.id)); assert.equal(row.version, 3); assert.equal(row.cells[f.output.id], "step two");
  assert.equal((await db.select().from(automationStepReceipts).where(eq(automationStepReceipts.runId, failed.id))).length, 2);
  const stale = await queue.add("stale", f.job.data, { jobId: `stale-${randomUUID()}` });
  await eventually(async () => await stale.getState() === "completed");
  assert.equal((await eventState(f.job.data.eventId)).generation, 1);
});

test("SIGKILL after a committed write recovers through BullMQ without repeating actions", async () => {
  for (const runtime of runtimes) await runtime.worker.pause();
  const f = await fixture(); assert.ok(f.job);
  const child = spawn(process.execPath, ["--import", "tsx", "test/queue/fault-worker.ts", "kill"], {
    env: { ...process.env, FAULT_EVENT_ID: f.job.data.eventId, WORKER_LOCK_MS: "1000", WORKER_STALLED_MS: "1000", AUTOMATION_LEASE_MS: "1000" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = ""; child.stdout.on("data", (d) => { output += String(d); }); child.stderr.on("data", () => {});
  try {
    await eventually(async () => output.includes("FAULT_READY"));
    await relay.tick();
    await eventually(async () => output.includes("FAULT_ACTION_COMMITTED"));
    const exited = new Promise((r) => child.once("exit", r)); child.kill("SIGKILL"); await exited;
    const replacement = startWorker(); runtimes.push(replacement); await replacement.ready;
    await eventually(async () => (await eventState(f.job!.data.eventId)).status === "completed");
    const [row] = await db.select().from(rows).where(eq(rows.id, f.row.id)); assert.equal(row.version, 2);
    await replacement.worker.pause();
  } finally { child.kill("SIGKILL"); }
});

test("SIGTERM drains an active worker before exit", async () => {
  const f = await fixture(); assert.ok(f.job);
  const child = spawn(process.execPath, ["--import", "tsx", "test/queue/fault-worker.ts", "drain"], { env: { ...process.env, FAULT_EVENT_ID: f.job.data.eventId }, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", (d) => { output += String(d); }); child.stderr.on("data", () => {});
  try {
    await eventually(async () => output.includes("FAULT_READY"));
    await relay.tick();
    await eventually(async () => output.includes("FAULT_ACTION_COMMITTED"));
    const exited = new Promise((resolve) => child.once("exit", resolve)); child.kill("SIGTERM"); assert.equal(await exited, 0);
    assert.equal((await eventState(f.job.data.eventId)).status, "completed");
  } finally { child.kill("SIGKILL"); }
});

test("Redis outage leaves durable pending deliveries; relay reconnects and sends them", {
  skip: process.env.QUEUE_TEST_REDIS_CONTAINER !== "agrid-queue-test-redis",
}, async () => {
  assert.equal(new URL(process.env.REDIS_URL!).port, "6381");
  for (const runtime of runtimes) await runtime.worker.pause();
  execFileSync("docker", ["stop", "--time", "1", "agrid-queue-test-redis"]);
  let f: Awaited<ReturnType<typeof fixture>>;
  try {
    const start = Date.now(); f = await fixture(); assert.ok(f.delivery);
    assert.ok(Date.now() - start < 2000, "Business transaction must not wait for Redis");
    assert.equal(f.delivery.status, "pending");
    assert.equal(await relay.tick(), 0);
    const [pending] = await db.select().from(automationOutbox).where(eq(automationOutbox.id, f.delivery.id));
    assert.equal(pending.status, "pending"); assert.ok(pending.lastError);
    assert.equal((await fixture({ enabled: false })).delivery, undefined);
  } finally {
    execFileSync("docker", ["start", "agrid-queue-test-redis"]);
    await eventually(async () => redis.status === "ready");
  }
  const recoveredWorker = startWorker(); runtimes.push(recoveredWorker); await recoveredWorker.ready;
  await eventually(async () => { await relay.tick(); return (await eventState(f!.job!.data.eventId)).status === "completed"; });
  const [row] = await db.select().from(rows).where(eq(rows.id, f!.row.id)); assert.equal(row.version, 2);
});
