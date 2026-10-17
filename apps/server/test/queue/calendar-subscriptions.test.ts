import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID, createHmac } from "node:crypto";
import { createServer } from "node:https";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { and, eq } from "drizzle-orm";
import { createRedisClient, redisConnectionOptions, waitForRedisReady } from "@tabdo/queue/redis";
import { createDatabase } from "../../src/business/db/factory.js";
import { organization, user, member, workspaces, calendarDeliveries, calendarDeliveryAttempts } from "../../src/business/db/schema.js";
import type { CommandDependencies } from "../../src/business/dependencies.js";
import { executeCalendar } from "../../src/business/calendar/service.js";
import { createAutomationControlQueue } from "../../src/automation/jobs/queues.js";
import { calendarTestCertificate, calendarTestKey, calendarTestOutbound } from "../fixtures/calendar-outbound.js";

const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_queue_test")); assert.equal(process.env.DATABASE_URL_UNPOOLED, url);
assert(new URL(url).pathname.includes(process.env.HERDR_TEAM_TEST_DATABASE!));
assert.equal(process.env.REDIS_URL, "redis://127.0.0.1:16446");
assert(process.env.QUEUE_PREFIX?.startsWith("agrid-queue-test-"));
assert.equal(process.env.QUEUE_PREFIX, process.env.HERDR_TEAM_REDIS_PREFIX);
const resource = createDatabase({ connectionString: url, poolMax: 5 }), db = resource.db;
const org = randomUUID(), uid = randomUUID();
const caller = { kind: "member" as const, organizationId: org, actorId: uid };
const deps: CommandDependencies = { database: db, now: () => new Date(), uuid: randomUUID, automationQueueName: "automation", calendarOutbound: calendarTestOutbound(Number(process.env.HERDR_TEAM_PORT)) };
const queue = createAutomationControlQueue(), redis = createRedisClient(redisConnectionOptions(process.env.REDIS_URL!, "producer"), { name: "0046-test" });
const children: ChildProcess[] = [], received: { body: string; timestamp: string }[] = [];
let calendarId: string, personId: string, secret: string, count = 0;
const receiver = createServer({ key: calendarTestKey, cert: calendarTestCertificate }, async (req, res) => {
  let body = ""; for await (const chunk of req) body += chunk;
  const [time, signature] = String(req.headers["x-tabdo-signature"]).split(",");
  assert.equal(signature, `v1=${createHmac("sha256", secret).update(`${time.slice(2)}.${body}`).digest("hex")}`);
  received.push({ body, timestamp: time }); res.writeHead(204); res.end();
});
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(check: () => Promise<boolean>, timeout = 20000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await check()) return; await wait(50); } throw new Error("Timed out"); }
async function stop(child: ChildProcess) { if (child.exitCode !== null || child.signalCode) return; const exited = new Promise(resolve => child.once("exit", resolve)); child.kill("SIGTERM"); await exited; }
async function start(faultId = "") {
  const child = spawn(process.execPath, ["--import", "tsx", "test/queue/calendar-subscriptions-worker.ts"], { env: { ...process.env, FAULT_DELIVERY_ID: faultId }, stdio: ["ignore", "pipe", "pipe"] }); children.push(child);
  let output = ""; child.stdout!.on("data", value => { output += value; }); child.stderr!.on("data", value => { output += value; });
  await eventually(async () => { assert(child.exitCode === null && !child.signalCode || output.includes("SUBSCRIPTION_WORKER_READY"), output); return output.includes("SUBSCRIPTION_WORKER_READY"); });
  return child;
}
async function booking() {
  const start = Date.parse("2030-01-07T00:00:00Z") + count++ * 60_000;
  return executeCalendar(deps, caller, "createBooking", { calendarId, personId, title: "Private queue customer", time: { start: new Date(start).toISOString(), end: new Date(start + 60000).toISOString(), timeZone: "UTC" }, idempotencyKey: randomUUID() });
}
before(async () => {
  await db.insert(organization).values({ id: org, name: "0046 queue", slug: org });
  await db.insert(user).values({ id: uid, name: "Owner", email: `${uid}@local.test` });
  await db.insert(member).values({ id: randomUUID(), organizationId: org, userId: uid, role: "owner" });
  const [space] = await db.select().from(workspaces).where(eq(workspaces.organizationId, org));
  const bound = { ...deps, workspaceId: space.id };
  calendarId = (await executeCalendar(bound, caller, "createCalendar", { name: "Queue calendar", timeZone: "UTC", idempotencyKey: randomUUID() })).id;
  personId = (await executeCalendar(bound, caller, "createCalendarPerson", { calendarId, name: "Dentist", timeZone: "UTC", idempotencyKey: randomUUID() })).id;
  await executeCalendar(bound, caller, "setWorkingHours", { calendarId, personId, windows: [{ day: 1, start: "00:00", end: "24:00" }], expectedVersion: 1, idempotencyKey: randomUUID() });
  secret = (await executeCalendar(bound, caller, "createCalendarSubscription", { calendarId, name: "Queue receiver", endpoint: "https://receiver.example.test/queue", eventTypes: ["booking.created"], idempotencyKey: randomUUID() })).secret!;
  await new Promise<void>(resolve => receiver.listen(Number(process.env.HERDR_TEAM_PORT), "127.0.0.1", resolve));
});
after(async () => {
  for (const child of children) await stop(child);
  receiver.closeAllConnections(); await new Promise<void>(resolve => receiver.close(() => resolve()));
  await db.delete(organization).where(eq(organization.id, org)); await db.delete(user).where(eq(user.id, uid));
  await queue.close(); await waitForRedisReady(redis); const keys = await redis.keys(`${process.env.QUEUE_PREFIX}:*`); if (keys.length) await redis.del(...keys); redis.disconnect(); await resource.close();
});
test("real worker crash after HTTPS receipt recovers SQL lease, stable IDs and unknown attempt without replaying booking actions", { timeout: 45000 }, async () => {
  const b = await booking(); const [delivery] = await db.select().from(calendarDeliveries).where(eq(calendarDeliveries.calendarId, calendarId));
  const faulted = await start(delivery.id); await eventually(async () => faulted.signalCode === "SIGKILL");
  assert.equal(received.length, 1);
  const [reserved] = await db.select().from(calendarDeliveries).where(eq(calendarDeliveries.id, delivery.id)); assert.equal(reserved.status, "delivering"); assert.equal(reserved.attemptCount, 1);
  await db.update(calendarDeliveries).set({ claimUntil: new Date(0) }).where(eq(calendarDeliveries.id, delivery.id));
  await Promise.all([queue.publish({ id: randomUUID(), body: { kind: "calendar-deliveries" } }), queue.publish({ id: randomUUID(), body: { kind: "calendar-deliveries" } })]);
  const replacement = await start();
  try {
    await eventually(async () => (await db.select().from(calendarDeliveries).where(eq(calendarDeliveries.id, delivery.id)))[0].status === "succeeded");
    assert.equal(received.length, 2); assert.equal(received[0].body, received[1].body);
    const attempts = await db.select().from(calendarDeliveryAttempts).where(eq(calendarDeliveryAttempts.deliveryId, delivery.id));
    assert.deepEqual(attempts.map(v => v.status).sort(), ["succeeded", "unknown"]);
    const seen = JSON.parse(received[0].body); assert.equal(seen.aggregateId, b.id); assert.equal(seen.aggregateVersion, 1); assert(!received[0].body.includes("Private queue customer"));
    await queue.publish({ id: randomUUID(), body: { kind: "calendar-deliveries" } }); await wait(300); assert.equal(received.length, 2);
    console.log("SUBSCRIPTION_CRASH_RECOVERY", JSON.stringify({ deliveryId: delivery.id, eventId: seen.eventId, attempts: 2, remoteMayRepeat: true }));
  } finally { await stop(replacement); }
});
test("lost wakeup and dedicated Redis outage retain committed events for startup recovery", { timeout: 45000 }, async () => {
  assert.equal(process.env.QUEUE_TEST_REDIS_CONTAINER, "agrid-0046-redis");
  execFileSync("docker", ["stop", "-t", "0", "agrid-0046-redis"]);
  let b: Awaited<ReturnType<typeof booking>>;
  try { b = await booking(); assert.equal((await db.select().from(calendarDeliveries).where(and(eq(calendarDeliveries.calendarId, calendarId), eq(calendarDeliveries.status, "pending")))).length, 1); }
  finally { execFileSync("docker", ["start", "agrid-0046-redis"]); }
  const replacement = await start();
  try { await eventually(async () => received.some(v => JSON.parse(v.body).aggregateId === b.id)); assert.equal(received.filter(v => JSON.parse(v.body).aggregateId === b.id).length, 1); }
  finally { await stop(replacement); }
});
