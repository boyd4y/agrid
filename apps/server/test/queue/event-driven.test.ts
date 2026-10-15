import assert from "node:assert/strict";
import { test as register, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "../../src/business/db/factory.js";
import { withPlatformResources, type PlatformResources } from "../../src/resources/scope.js";
import { commandDependencies } from "../../src/services/dependencies.js";
import { createAutomationNotifier } from "../../src/automation/jobs/notifications.js";
import { createAutomationService } from "../../src/automation/jobs/service.js";
import { createAutomationControlQueue, createAutomationQueue } from "../../src/automation/jobs/queues.js";
import { createRedisClient, waitForRedisReady, redisConnectionOptions } from "@tabdo/queue/redis";
import { createTable, getTable, addRow } from "../../src/commands/index.js";
import { createAutomation, updateAutomation } from "../../src/automation/crud.js";
import { organization, user, member, rows, automationOutbox, automationEvents, automationSchedules, automationOccurrences } from "../../src/db/schema.js";
import type { BackgroundWakeup } from "../../src/business/background.js";

assert(new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_queue_test"));
assert.equal(new URL(process.env.REDIS_URL ?? "").port, "6381");
const prefix = process.env.QUEUE_PREFIX!;
assert(prefix.startsWith("agrid-queue-test-event-"));
const queries: string[] = [], hints: BackgroundWakeup[] = [];
const database = createDatabase({ connectionString: process.env.DATABASE_URL!, poolMax: 5,
  logger: { logQuery(query) { queries.push(query); } } });
const db = database.db;
const notifier = createAutomationNotifier();
const resources: PlatformResources = { database, background: {
  notify(wakeup) { hints.push(wakeup); notifier.notify(wakeup); }, drain: () => notifier.drain(),
} };
const raw = createRedisClient(redisConnectionOptions(process.env.REDIS_URL!, "producer"), { name: "event-driven-test" });
const control = createAutomationControlQueue();
const org = randomUUID(), owner = randomUUID(), scope = { organizationId: org, actorId: owner };
let service: ReturnType<typeof createAutomationService> | undefined;
function test(name: string, work: () => Promise<void>) {
  register(name, { timeout: 20_000 }, () => withPlatformResources(resources, work));
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(check: () => Promise<boolean>, timeout = 8000) {
  const began = Date.now();
  while (!await check()) { if (Date.now() - began > timeout) throw new Error("Timed out waiting for event-driven work"); await sleep(20); }
}
async function settled() {
  await notifier.drain();
  await eventually(async () => {
    const counts = (await control.status()).counts;
    return !counts.active && !counts.waiting;
  });
  await sleep(150);
}
async function fixture() {
  const table = await createTable({ ...scope, name: `Wake ${randomUUID()}` });
  const title = (await getTable({ ...scope, tableId: table.id })).columns[0].id;
  const rule = await createAutomation({ ...scope, tableId: table.id, name: "Complete from Redis",
    trigger: { type: "row_created" }, actions: [{ type: "update_field", columnId: title, value: "completed" }] });
  return { table: { ...table, title }, rule };
}
async function finished(rowId: string) {
  const [event] = await db.select().from(automationEvents).where(eq(automationEvents.rowId, rowId));
  return event?.status === "completed";
}
async function deadline(ruleId: string, at: Date) {
  await db.transaction(async tx => {
    await tx.update(automationSchedules).set({ nextRunAt: at }).where(eq(automationSchedules.automationId, ruleId));
    commandDependencies().wakeAfterCommit!(tx, { kind: "schedules" });
  });
}
before(async () => {
  await waitForRedisReady(raw);
  await db.insert(user).values({ id: owner, name: "Event-driven fixture", email: `${owner}@local.test` });
  await db.insert(organization).values({ id: org, name: "Event-driven fixture", slug: org });
  await db.insert(member).values({ id: randomUUID(), userId: owner, organizationId: org, role: "owner" });
});
after(async () => {
  try {
    await service?.close(); await notifier.drain(); await control.close();
    await db.delete(automationEvents).where(eq(automationEvents.organizationId, org));
    await db.delete(organization).where(eq(organization.id, org)); await db.delete(user).where(eq(user.id, owner));
    const keys = await raw.keys(`${prefix}:*`); if (keys.length) await raw.del(...keys);
  } finally { raw.disconnect(); await database.close(); }
});

test("commit effects are deduplicated, follow outer commit and respect savepoint/transaction rollback", async () => {
  const effects: string[] = [];
  let savedTx: Parameters<typeof database.afterCommit>[0] | undefined;
  await db.transaction(async tx => {
    savedTx = tx;
    database.afterCommit(tx, "first", () => effects.push("replaced"));
    database.afterCommit(tx, "first", () => effects.push("outer"));
    await tx.transaction(async child => { database.afterCommit(child, "child", () => effects.push("child")); });
    await assert.rejects(tx.transaction(async child => {
      database.afterCommit(child, "first", () => effects.push("rolled-back replacement"));
      throw new Error("savepoint rollback");
    }), /savepoint rollback/);
    assert.deepEqual(effects, []);
  });
  assert.deepEqual(effects, ["outer", "child"]);
  assert.throws(() => database.afterCommit(savedTx!, "late", () => {}), /active transaction/);
  await assert.rejects(db.transaction(async tx => {
    database.afterCommit(tx, "never", () => effects.push("never")); throw new Error("outer rollback");
  }), /outer rollback/);
  assert.deepEqual(effects, ["outer", "child"]);
  assert.equal(await db.transaction(async tx => {
    database.afterCommit(tx, "broken hint", () => { throw new Error("Redis unavailable"); }); return "committed";
  }), "committed");
});

test("product wakeups happen only after durable commit; rollback emits no wake or outbox", async () => {
  const { table } = await fixture();
  const initial = hints.length;
  await assert.rejects(db.transaction(async tx => {
    await addRow({ ...scope, tableId: table.id }, tx);
    assert.equal(hints.length, initial); throw new Error("reject mutation");
  }), /reject mutation/);
  assert.equal(hints.length, initial);
  assert.equal((await db.select().from(rows).where(eq(rows.tableId, table.id))).length, 0);
  await db.transaction(async tx => {
    await addRow({ ...scope, tableId: table.id }, tx); await addRow({ ...scope, tableId: table.id }, tx);
    assert.equal(hints.length, initial);
  });
  assert.equal(hints.length, initial + 1, "one hint for multiple committed outbox records");
  assert.equal(hints.at(-1)?.kind, "outbox"); await notifier.drain();
});

test("idle worker performs no periodic SQL and a new event wakes immediately through Redis", async () => {
  service = createAutomationService({ closeDatabase: false }); await service.ready;
  await settled();
  const baseline = queries.length;
  await sleep(1300);
  assert.equal(queries.length, baseline, "idle worker must not query PG every 500ms");
  const { table } = await fixture();
  const began = Date.now(), row = await addRow({ ...scope, tableId: table.id });
  await eventually(() => finished(row.id));
  assert(Date.now() - began < 2000, "normal dispatch cannot wait for the 15-minute safety sweep");
  const [saved] = await db.select().from(rows).where(eq(rows.id, row.id));
  assert.equal(saved.cells[table.title], "completed"); assert.equal(saved.version, 2);
  for (let i = 0; i < 3; i++) await control.publish({ id: randomUUID(), body: { kind: "outbox" } });
  await settled();
  assert.equal((await db.select().from(rows).where(eq(rows.id, row.id)))[0].version, 2);
  const idle = queries.length; await sleep(1100); assert.equal(queries.length, idle);
});

test("Redis wakeups drain more than one outbox batch without a periodic database scan", async () => {
  const { table } = await fixture();
  const added = await Promise.all(Array.from({ length: 32 }, () => addRow({ ...scope, tableId: table.id })));
  await eventually(async () => (await Promise.all(added.map(row => finished(row.id)))).every(Boolean));
  assert.equal((await db.select().from(rows).where(eq(rows.tableId, table.id))).filter(row => row.version === 2).length, 32);
});

test("schedule deadlines wake through Redis and duplicate/stale timers cannot execute disabled or edited plans", async () => {
  const table = await createTable({ ...scope, name: `Schedule ${randomUUID()}` });
  const rule = await createAutomation({ ...scope, source: { kind: "schedule", cron: "0 0 * * *", timeZone: "UTC" },
    name: "Redis clock", trigger: { type: "schedule_due" }, actions: [{ type: "command", command: "addRow", input: { tableId: table.id } }] });
  await deadline(rule.id, new Date(Date.now() + 600)); await settled();
  assert.equal((await db.select().from(automationOccurrences).where(eq(automationOccurrences.automationId, rule.id))).length, 0);
  await eventually(async () => (await db.select().from(rows).where(eq(rows.tableId, table.id))).length === 1);
  for (let i = 0; i < 2; i++) await control.publish({ id: randomUUID(), body: { kind: "schedules" } });
  await settled(); assert.equal((await db.select().from(rows).where(eq(rows.tableId, table.id))).length, 1);
  await deadline(rule.id, new Date(Date.now() + 600)); await settled();
  await updateAutomation({ ...scope, automationId: rule.id, source: { kind: "schedule", cron: "0 12 * * *", timeZone: "UTC" } });
  await sleep(850); await settled(); assert.equal((await db.select().from(rows).where(eq(rows.tableId, table.id))).length, 1, "an edited cursor replaces the old timer's authority");
  await deadline(rule.id, new Date(Date.now() + 600)); await settled();
  await updateAutomation({ ...scope, automationId: rule.id, enabled: false });
  await sleep(850); await settled(); assert.equal((await db.select().from(rows).where(eq(rows.tableId, table.id))).length, 1);
});

test("startup recovers a committed event with no Redis notification", async () => {
  await settled(); await service!.close(); service = undefined;
  const { table } = await fixture();
  const row = await withPlatformResources({ database, background: { notify() { throw new Error("Redis notification unavailable"); } } },
    () => addRow({ ...scope, tableId: table.id }));
  assert.equal(await finished(row.id), false);
  service = createAutomationService({ closeDatabase: false }); await service.ready;
  await eventually(() => finished(row.id));
});

test("failed publication retries at its persisted deadline through Redis, rather than waiting for the safety sweep", async () => {
  await settled(); await service!.close(); service = undefined;
  const delivery = createAutomationQueue(); let attempts = 0;
  service = createAutomationService({ closeDatabase: false, publisher: {
    async publish(message) { if (++attempts === 1) throw new Error("injected one-shot publish failure"); await delivery.publish(message); },
    close: () => delivery.close(),
  } }); await service.ready;
  const { table } = await fixture();
  const row = await addRow({ ...scope, tableId: table.id });
  await eventually(() => finished(row.id)); assert(attempts >= 2);
  const [event] = await db.select().from(automationEvents).where(eq(automationEvents.rowId, row.id));
  const [outbox] = await db.select().from(automationOutbox).where(eq(automationOutbox.eventId, event.id));
  assert(outbox.attempts >= 2); assert.equal(outbox.status, "done");
});

test("the low-frequency safety sweep recovers lost post-commit notifications without a restart", async () => {
  await settled(); await service!.close(); service = undefined;
  service = createAutomationService({ closeDatabase: false, recoveryIntervalMs: 300 }); await service.ready;
  await settled();
  const { table } = await fixture();
  const row = await withPlatformResources({ database }, () => addRow({ ...scope, tableId: table.id }));
  await eventually(() => finished(row.id));
  await service.close(); service = undefined;
});
