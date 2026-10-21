import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID, createHmac } from "node:crypto";
import { createServer } from "node:https";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDatabase } from "../../src/business/db/factory.js";
import { organization, user, member, workspaces, calendars, bookings, calendarEvents, calendarDeliveries, calendarSubscriptions, calendarReceipts, calendarDeliveryAttempts } from "../../src/business/db/schema.js";
import type { CommandDependencies } from "../../src/business/dependencies.js";
import type { CalendarCommand, CalendarCommands, CalendarEventType, CalendarSubscription } from "@tabdo/shared";
import { executeCalendar, type CalendarCaller } from "../../src/business/calendar/service.js";
import { dispatchCalendarDeliveries, nextCalendarDeliveryDeadline } from "../../src/business/calendar/outbound.js";
import { CalendarError } from "../../src/business/calendar/errors.js";
import { createSiteKey, updateSiteKey, deleteSiteKey } from "../../src/business/data-api/keys.js";
import type { Actor } from "../../src/business/auth/actor.js";
import { calendarTestCertificate, calendarTestKey, calendarTestOutbound } from "../fixtures/calendar-outbound.js";

const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test")); assert.equal(process.env.DATABASE_URL_UNPOOLED, url);
if (process.env.HERDR_TEAM_TEST_DATABASE) assert(new URL(url).pathname.includes(process.env.HERDR_TEAM_TEST_DATABASE));
const resource = createDatabase({ connectionString: url, poolMax: 8 }), db = resource.db;
const org = randomUUID(), uid = randomUUID(), mid = randomUUID(), regularId = randomUUID();
const caller: CalendarCaller = { kind: "member", organizationId: org, actorId: uid };
const actor: Actor = { kind: "human", organizationId: org, userId: uid, memberId: mid, role: "owner", name: "Subscriptions", email: `${uid}@local.test` };
let now = new Date("2029-01-01T00:00:00Z"), calendarId: string, personId: string, workspaceId: string, secondCalendar: string;
let deps: CommandDependencies;
const received: { path: string; body: string; headers: import("node:http").IncomingHttpHeaders }[] = [];
const responses = new Map<string, number[]>(), secrets = new Map<string, string>();
const receiver = createServer({ key: calendarTestKey, cert: calendarTestCertificate }, async (req, res) => {
  let body = ""; for await (const chunk of req) body += chunk;
  const path = req.url!, record = { path, body, headers: req.headers }; received.push(record);
  const [stamp, signature] = String(req.headers["x-tabdo-signature"]).split(",");
  const expected = createHmac("sha256", secrets.get(path)!).update(`${stamp.slice(2)}.${body}`).digest("hex");
  assert.equal(signature, `v1=${expected}`);
  const parsed = JSON.parse(body); assert.equal(req.headers["x-tabdo-delivery-id"], parsed.deliveryId); assert.equal(req.headers["x-tabdo-event-id"], parsed.eventId);
  res.writeHead(responses.get(path)?.shift() ?? 204); res.end();
});
const k = randomUUID;
const call = <K extends CalendarCommand>(command: K, input: CalendarCommands[K], who: CalendarCaller = caller, bound = deps) => executeCalendar(bound, who, command, input);
const code = (expected: string) => (error: unknown) => error instanceof CalendarError && error.code === expected;
let minute = 0;
async function booking() {
  const start = Date.parse("2030-01-07T00:00:00Z") + minute++ * 60_000;
  return call("createBooking", { calendarId, personId, title: "PRIVATE CUSTOMER MUST NEVER LEAVE", time: { start: new Date(start).toISOString(), end: new Date(start + 60_000).toISOString(), timeZone: "UTC" }, idempotencyKey: k() });
}
async function subscribe(path: string, eventTypes: CalendarEventType[] = ["booking.created"], who = caller) {
  const result = await call("createCalendarSubscription", { calendarId, name: path, endpoint: `https://receiver.example.test/${path}`, eventTypes, idempotencyKey: k() }, who);
  assert(result.secret); secrets.set(`/${path}`, result.secret); return result.subscription;
}
const logs = (s: CalendarSubscription) => call("listCalendarDeliveries", { calendarId: s.calendarId, subscriptionId: s.id, limit: 100 });
const revoke = (s: CalendarSubscription) => call("revokeCalendarSubscription", { calendarId: s.calendarId, subscriptionId: s.id, expectedVersion: s.version, idempotencyKey: k() });
before(async () => {
  await db.insert(organization).values({ id: org, name: "Calendar subscriptions", slug: org });
  await db.insert(user).values([{ id: uid, name: actor.name, email: actor.email }, { id: regularId, name: "Regular", email: `${regularId}@local.test` }]);
  await db.insert(member).values([{ id: mid, organizationId: org, userId: uid, role: "owner" }, { id: k(), organizationId: org, userId: regularId, role: "member" }]);
  [workspaceId] = (await db.select().from(workspaces).where(eq(workspaces.organizationId, org))).map(v => v.id);
  await new Promise<void>(resolve => receiver.listen(Number(process.env.HERDR_TEAM_PORT), "127.0.0.1", resolve));
  deps = { database: db, now: () => now, uuid: k, automationQueueName: "unused", workspaceId, calendarOutbound: calendarTestOutbound(Number(process.env.HERDR_TEAM_PORT)) };
  calendarId = (await call("createCalendar", { name: "Calendar", timeZone: "UTC", idempotencyKey: k() })).id;
  secondCalendar = (await call("createCalendar", { name: "Same workspace", timeZone: "UTC", idempotencyKey: k() })).id;
  personId = (await call("createCalendarPerson", { calendarId, name: "PRIVATE PERSON", timeZone: "UTC", idempotencyKey: k() })).id;
  await call("setWorkingHours", { calendarId, personId, expectedVersion: 1, windows: [{ day: 1, start: "00:00", end: "24:00" }], idempotencyKey: k() });
});
after(async () => {
  receiver.closeAllConnections(); await new Promise<void>(resolve => receiver.close(() => resolve()));
  await db.delete(organization).where(eq(organization.id, org)); await db.delete(user).where(inArray(user.id, [uid, regularId])); await resource.close();
});
test("journal/outbox/receipts are atomic; duplicate and failed batches never produce extra events; reference-only HMAC delivery", async () => {
  const subscription = await subscribe("atomic", ["booking.created", "booking.rescheduled", "booking.cancelled"]);
  const b = await booking();
  const retryKey = k(), first = await call("cancelBooking", { calendarId, bookingId: b.id, expectedVersion: b.version, idempotencyKey: retryKey });
  assert.deepEqual(await call("cancelBooking", { calendarId, bookingId: b.id, expectedVersion: b.version, idempotencyKey: retryKey }), first);
  const events = await db.select().from(calendarEvents).where(eq(calendarEvents.aggregateId, b.id));
  assert.equal(events.length, 2); assert.deepEqual(events.map(v => v.aggregateVersion).sort(), [1, 2]);
  const beforeCount = (await logs(subscription)).items.length;
  await assert.rejects(call("batchBookings", { calendarId, operations: [{ kind: "create", personId, title: "should rollback", time: { start: "2030-01-07T12:00:00Z", end: "2030-01-07T12:30:00Z", timeZone: "UTC" } }, { kind: "cancel", bookingId: b.id, expectedVersion: 1 }], idempotencyKey: k() }), code("VERSION_CONFLICT"));
  assert.equal((await logs(subscription)).items.length, beforeCount);
  await db.transaction(async tx => {
    await executeCalendar(deps, caller, "createBooking", { calendarId, personId, title: "outer rollback", time: { start: "2030-01-07T13:00:00Z", end: "2030-01-07T13:30:00Z", timeZone: "UTC" }, idempotencyKey: k() }, tx);
    throw new Error("rollback outer");
  }).catch(error => assert.match(error.message, /rollback outer/));
  assert.equal((await logs(subscription)).items.length, beforeCount);
  assert(await nextCalendarDeliveryDeadline(deps));
  await Promise.all([dispatchCalendarDeliveries(deps), dispatchCalendarDeliveries(deps)]);
  assert.equal(received.filter(v => v.path === "/atomic").length, 2);
  for (const value of received.filter(v => v.path === "/atomic")) {
    assert(!value.body.includes("PRIVATE")); assert(!value.body.includes(personId));
    assert.deepEqual(Object.keys(JSON.parse(value.body)).sort(), ["protocol", "eventId", "workspaceId", "calendarId", "type", "aggregateId", "aggregateVersion", "occurredAt", "deliveryId"].sort());
  }
  await dispatchCalendarDeliveries(deps); assert.equal(received.filter(v => v.path === "/atomic").length, 2);
  assert((await logs(subscription)).items.every(v => v.status === "succeeded" && v.attemptCount === 1));
  await revoke(subscription);
});
test("one-time encrypted secrets, paginated status, pause/resume/rotation/revocation preserve audit without replay", async () => {
  const input = { calendarId, name: "lifecycle", endpoint: "https://receiver.example.test/lifecycle", eventTypes: ["booking.created"] as CalendarEventType[], idempotencyKey: k() };
  const created = await call("createCalendarSubscription", input); assert(created.secret); secrets.set("/lifecycle", created.secret);
  assert.equal((await call("createCalendarSubscription", input)).secret, undefined);
  const stored = (await db.select().from(calendarSubscriptions).where(eq(calendarSubscriptions.id, created.subscription.id)))[0];
  assert(!JSON.stringify(stored).includes(created.secret));
  const receipts = await db.select().from(calendarReceipts).where(eq(calendarReceipts.key, input.idempotencyKey)); assert(!JSON.stringify(receipts).includes(created.secret));
  assert(!JSON.stringify(await call("getCalendarSubscription", { calendarId, subscriptionId: stored.id })).includes("encrypted"));
  await booking(); await booking();
  const firstPage = await call("listCalendarDeliveries", { calendarId, subscriptionId: stored.id, limit: 1, status: "pending" }); assert(firstPage.hasMore); assert(firstPage.nextCursor);
  const secondPage = await call("listCalendarDeliveries", { calendarId, subscriptionId: stored.id, limit: 1, cursor: firstPage.nextCursor }); assert(!secondPage.hasMore); assert.notEqual(firstPage.items[0].id, secondPage.items[0].id);
  const rotated = await call("rotateCalendarSubscriptionSecret", { calendarId, subscriptionId: stored.id, expectedVersion: 1, idempotencyKey: k() }); assert(rotated.secret); assert.notEqual(rotated.secret, created.secret); secrets.set("/lifecycle", rotated.secret);
  assert((await logs(rotated.subscription)).items.every(v => v.status === "skipped"));
  await booking(); await dispatchCalendarDeliveries(deps);
  assert.equal(received.filter(v => v.path === "/lifecycle").length, 1);
  const paused = await call("updateCalendarSubscription", { ...input, idempotencyKey: k(), subscriptionId: stored.id, expectedVersion: 2, status: "paused" });
  await booking(); assert.equal((await logs(paused)).items.length, 3);
  const resumed = await call("updateCalendarSubscription", { ...input, idempotencyKey: k(), subscriptionId: stored.id, expectedVersion: 3, status: "active" });
  await booking(); await revoke(resumed); await dispatchCalendarDeliveries(deps);
  assert.equal(received.filter(v => v.path === "/lifecycle").length, 1);
  await assert.rejects(call("rotateCalendarSubscriptionSecret", { calendarId, subscriptionId: stored.id, expectedVersion: 5, idempotencyKey: k() }), code("INVALID_STATE"));
});
test("five finite retries, complete attempt history and explicit retry reuse delivery/event IDs without touching bookings", async () => {
  const subscription = await subscribe("retry"); responses.set("/retry", [503, 503, 503, 503, 503, 204]);
  const b = await booking();
  for (let attempt = 1; attempt <= 5; attempt++) { await dispatchCalendarDeliveries(deps); now = new Date(+now + 700_000); }
  const [delivery] = (await logs(subscription)).items; assert.equal(delivery.status, "deadletter"); assert.equal(delivery.attemptCount, 5);
  const history = await call("getCalendarDelivery", { calendarId, subscriptionId: subscription.id, deliveryId: delivery.id }); assert.equal(history.attempts.length, 5); assert(history.attempts.every(v => v.httpStatus === 503 && v.status === "failed"));
  const key = k(), retry = { calendarId, subscriptionId: subscription.id, deliveryId: delivery.id, expectedVersion: 1, idempotencyKey: key };
  await call("retryCalendarDelivery", retry); await call("retryCalendarDelivery", retry); await dispatchCalendarDeliveries(deps);
  const final = await call("getCalendarDelivery", { calendarId, subscriptionId: subscription.id, deliveryId: delivery.id }); assert.equal(final.delivery.status, "succeeded"); assert.equal(final.attempts.length, 6);
  const sent = received.filter(v => v.path === "/retry"); assert.equal(sent.length, 6); assert.equal(new Set(sent.map(v => v.body)).size, 1);
  assert.equal((await db.select().from(bookings).where(eq(bookings.id, b.id)))[0].version, 1);
  await revoke(subscription);
});
test("shared personnel schedule mutations journal into each same-workspace calendar, never another workspace", async () => {
  const subscription = await call("createCalendarSubscription", { calendarId: secondCalendar, name: "other calendar", endpoint: "https://receiver.example.test/schedules", eventTypes: ["working_hours.updated", "availability_exception.created", "availability_exception.removed"], idempotencyKey: k() });
  secrets.set("/schedules", subscription.secret!);
  await call("setWorkingHours", { calendarId, personId, expectedVersion: 2, windows: [{ day: 1, start: "00:00", end: "24:00" }], idempotencyKey: k() });
  const exception = await call("setAvailabilityException", { calendarId, personId, date: "2030-01-08", intervals: [{ start: "00:00", end: "24:00" }], idempotencyKey: k() });
  await call("removeAvailabilityException", { calendarId, personId, exceptionId: exception.id, expectedVersion: 1, idempotencyKey: k() });
  const history = await logs(subscription.subscription); assert.equal(history.items.length, 3); assert(history.items.every(v => v.event.calendarId === secondCalendar && v.event.workspaceId === workspaceId));
  const [other] = await db.insert(workspaces).values({ organizationId: org, name: "Unrelated" }).returning();
  await assert.rejects(call("getCalendarSubscription", { calendarId: secondCalendar, subscriptionId: subscription.subscription.id }, caller, { ...deps, workspaceId: other.id }), code("NOT_FOUND"));
  await assert.rejects(db.insert(calendarEvents).values({ workspaceId: other.id, calendarId, type: "calendar.updated", aggregateId: calendarId, aggregateVersion: 50, envelope: history.items[0].event }), (error: any) => error.cause?.code === "23503");
  await dispatchCalendarDeliveries(deps); await revoke(subscription.subscription);
});
test("independent grants, key ownership and durable permission narrowing prevent disclosure and stop old deliveries", async () => {
  const grant = { calendarId, canRead: true, canReadAvailability: false, canCreate: false, canUpdate: false, canCancel: false, canManage: true, canSubscribe: true };
  const saved = await createSiteKey(deps, actor, { name: "subscriber", permissions: [], calendarPermissions: [grant] }); const who: CalendarCaller = { kind: "key", secret: saved.secret };
  const subscription = await subscribe("key", ["booking.created"], who); await booking();
  await assert.rejects(call("listCalendarDeliveries", { calendarId, subscriptionId: subscription.id }, who), code("FORBIDDEN"));
  await assert.rejects(call("revokeCalendarSubscription", { calendarId, subscriptionId: subscription.id, expectedVersion: 1, idempotencyKey: k() }, who), code("FORBIDDEN"));
  const peer = await createSiteKey(deps, actor, { name: "other subscriber", permissions: [], calendarPermissions: [{ ...grant, canReadDeliveries: true, canManageSubscriptions: true }] });
  await assert.rejects(call("getCalendarSubscription", { calendarId, subscriptionId: subscription.id }, { kind: "key", secret: peer.secret }), code("NOT_FOUND"));
  await updateSiteKey(deps, actor, saved.key.id, { name: "narrowed", permissions: [], calendarPermissions: [{ ...grant, canRead: false }] });
  await updateSiteKey(deps, actor, saved.key.id, { name: "restored", permissions: [], calendarPermissions: [grant] });
  const current = await call("getCalendarSubscription", { calendarId, subscriptionId: subscription.id }, who); assert.equal(current.status, "paused");
  await dispatchCalendarDeliveries(deps); assert.equal(received.filter(v => v.path === "/key").length, 0);
  const [skipped] = (await logs(subscription)).items; assert.equal(skipped.lastError, "authorization_revoked");
  const bare = await createSiteKey(deps, actor, { name: "no subscribe", permissions: [], calendarPermissions: [{ ...grant, canSubscribe: false }] });
  await assert.rejects(subscribe("not-authorized", ["booking.created"], { kind: "key", secret: bare.secret }), code("FORBIDDEN"));
  await assert.rejects(subscribe("ordinary", ["booking.created"], { kind: "member", organizationId: org, actorId: regularId }), code("FORBIDDEN"));
  await deleteSiteKey(deps, actor, saved.key.id); await booking(); await dispatchCalendarDeliveries(deps); assert.equal(received.filter(v => v.path === "/key").length, 0);
  const memberSub = await subscribe("member-revoked"); await booking();
  await db.update(member).set({ role: "member" }).where(eq(member.id, mid));
  await dispatchCalendarDeliveries(deps); assert.equal(received.filter(v => v.path === "/member-revoked").length, 0);
  await db.update(member).set({ role: "owner" }).where(eq(member.id, mid));
  assert.equal((await logs(memberSub)).items[0].lastError, "authorization_revoked");
  await revoke(memberSub);
});

test("CRUD subscriptions use Create/Read/Update/Delete and revoking Create durably stops pending deliveries", async () => {
  const grant = { calendarId, canRead: false, canUpdate: false, canDelete: false, canCreate: true };
  const createOnly = await createSiteKey(deps, actor, { name: "Create without Read", permissions: [], calendarPermissions: [grant] });
  await assert.rejects(subscribe("no-read", ["booking.created"], { kind: "key", secret: createOnly.secret }), code("FORBIDDEN"));
  const saved = await createSiteKey(deps, actor, { name: "CRUD subscriber", permissions: [], calendarPermissions: [{ ...grant, canRead: true }] });
  const who: CalendarCaller = { kind: "key", secret: saved.secret };
  const subscription = await subscribe("crud", ["booking.created"], who);
  await call("getCalendarSubscription", { calendarId, subscriptionId: subscription.id }, who);
  await assert.rejects(call("rotateCalendarSubscriptionSecret", { calendarId, subscriptionId: subscription.id, expectedVersion: 1, idempotencyKey: k() }, who), code("FORBIDDEN"));
  await assert.rejects(call("revokeCalendarSubscription", { calendarId, subscriptionId: subscription.id, expectedVersion: 1, idempotencyKey: k() }, who), code("FORBIDDEN"));
  await booking();
  await updateSiteKey(deps, actor, saved.key.id, { name: "Read only", permissions: [], calendarPermissions: [{ ...grant, canCreate: false, canRead: true }] });
  assert.equal((await call("getCalendarSubscription", { calendarId, subscriptionId: subscription.id }, who)).status, "paused");
  assert.equal((await call("listCalendarDeliveries", { calendarId, subscriptionId: subscription.id }, who)).items[0].lastError, "authorization_revoked");
  await updateSiteKey(deps, actor, saved.key.id, { name: "Restore", permissions: [], calendarPermissions: [{ ...grant, canRead: true, canUpdate: true }] });
  await dispatchCalendarDeliveries(deps);
  assert.equal(received.filter(v => v.path === "/crud").length, 0);
  const current = await call("getCalendarSubscription", { calendarId, subscriptionId: subscription.id }, who);
  await call("updateCalendarSubscription", { calendarId, subscriptionId: subscription.id, name: current.name, endpoint: current.endpoint, eventTypes: current.eventTypes, status: "active", expectedVersion: current.version, idempotencyKey: k() }, who);
  const rotated = await call("rotateCalendarSubscriptionSecret", { calendarId, subscriptionId: subscription.id, expectedVersion: current.version + 1, idempotencyKey: k() }, who);
  assert(rotated.secret); secrets.set("/crud", rotated.secret);
  await assert.rejects(call("revokeCalendarSubscription", { calendarId, subscriptionId: subscription.id, expectedVersion: rotated.subscription.version, idempotencyKey: k() }, who), code("FORBIDDEN"));
  await updateSiteKey(deps, actor, saved.key.id, { name: "Delete only", permissions: [], calendarPermissions: [{ ...grant, canDelete: true, canCreate: false }] });
  const readRevoked = await createSiteKey(deps, actor, { name: "Read revocation", permissions: [], calendarPermissions: [{ ...grant, canRead: true }] });
  const readCaller: CalendarCaller = { kind: "key", secret: readRevoked.secret };
  const readSubscription = await subscribe("crud-read", ["booking.created"], readCaller);
  await booking();
  await updateSiteKey(deps, actor, readRevoked.key.id, { name: "Read removed", permissions: [], calendarPermissions: [grant] });
  await updateSiteKey(deps, actor, readRevoked.key.id, { name: "Read restored", permissions: [], calendarPermissions: [{ ...grant, canRead: true }] });
  await dispatchCalendarDeliveries(deps);
  assert.equal(received.filter(v => v.path === "/crud-read").length, 0);
  assert.equal((await call("getCalendarSubscription", { calendarId, subscriptionId: readSubscription.id }, readCaller)).status, "paused");
  await deleteSiteKey(deps, actor, readRevoked.key.id);
  const latest = await call("getCalendarSubscription", { calendarId, subscriptionId: subscription.id });
  assert.equal((await call("revokeCalendarSubscription", { calendarId, subscriptionId: subscription.id, expectedVersion: latest.version, idempotencyKey: k() }, who)).status, "revoked");
});

test("a late journal/outbox failure rolls back booking, event and receipt together", async () => {
  const subscription = await subscribe("late-failure");
  const functionName = `reject_delivery_${k().replaceAll("-", "")}`;
  const marker = k();
  await db.execute(sql.raw(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned outbox failure'; END $$`));
  await db.execute(sql.raw(`CREATE TRIGGER ${functionName} BEFORE INSERT ON calendar_deliveries FOR EACH ROW WHEN (NEW.subscription_id = '${subscription.id}'::uuid) EXECUTE FUNCTION ${functionName}()`));
  const beforeBookings = await db.select().from(bookings).where(eq(bookings.calendarId, calendarId));
  const beforeEvents = await db.select().from(calendarEvents).where(eq(calendarEvents.calendarId, calendarId));
  try {
    await assert.rejects(call("createBooking", { calendarId, personId, title: "late rollback", time: { start: "2030-01-07T22:00:00Z", end: "2030-01-07T22:01:00Z", timeZone: "UTC" }, idempotencyKey: marker }));
    assert.equal((await db.select().from(bookings).where(eq(bookings.calendarId, calendarId))).length, beforeBookings.length);
    assert.equal((await db.select().from(calendarEvents).where(eq(calendarEvents.calendarId, calendarId))).length, beforeEvents.length);
    assert.equal((await db.select().from(calendarReceipts).where(eq(calendarReceipts.key, marker))).length, 0);
    assert.equal((await logs(subscription)).items.length, 0);
  } finally { await db.execute(sql.raw(`DROP TRIGGER ${functionName} ON calendar_deliveries`)); await db.execute(sql.raw(`DROP FUNCTION ${functionName}()`)); await revoke(subscription); }
});
test("revocation waits for an already-started bounded send, then prevents every subsequent send", async () => {
  const subscription = await subscribe("revoke-race"); await booking();
  let arrived!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { arrived = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const transport = deps.calendarOutbound!;
  const dispatch = dispatchCalendarDeliveries({ ...deps, calendarOutbound: { ...transport, async send(input) { arrived(); await gate; return transport.send(input); } } });
  await ready;
  let revoked = false;
  const revokePromise = revoke(subscription).then(() => { revoked = true; });
  await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(revoked, false);
  release(); await dispatch; await revokePromise;
  assert.equal(received.filter(v => v.path === "/revoke-race").length, 1);
  await booking(); await dispatchCalendarDeliveries(deps); assert.equal(received.filter(v => v.path === "/revoke-race").length, 1);
});

test("corrupt event protocols and scope fail durably before HTTP; encryption setup fails without reserving a receipt", async () => {
  const subscription = await subscribe("invalid-event"); await booking();
  const [delivery] = (await logs(subscription)).items;
  await db.update(calendarEvents).set({ envelope: sql`jsonb_set(${calendarEvents.envelope}, '{protocol}', '99')` }).where(eq(calendarEvents.id, delivery.event.eventId));
  await dispatchCalendarDeliveries(deps);
  assert.equal(received.filter(v => v.path === "/invalid-event").length, 0);
  const record = await call("getCalendarDelivery", { calendarId, subscriptionId: subscription.id, deliveryId: delivery.id });
  assert.equal(record.delivery.status, "deadletter"); assert.equal(record.delivery.lastError, "invalid_event");
  assert.equal(record.attempts[0].httpStatus, null);
  await revoke(subscription);
  const marker = k();
  await assert.rejects(call("createCalendarSubscription", { calendarId, name: "unconfigured", endpoint: "https://receiver.example.test/unconfigured", eventTypes: ["booking.created"], idempotencyKey: marker }, caller, { ...deps, calendarOutbound: { ...deps.calendarOutbound!, encryptionKey: "" } }), code("SERVICE_UNAVAILABLE"));
  assert.equal((await db.select().from(calendarReceipts).where(eq(calendarReceipts.key, marker))).length, 0);
});

test("permission edits lock old and new calendar targets together before pausing subscriptions", async () => {
  const [small, large] = [calendarId, secondCalendar].sort();
  const grant = { calendarId: small, canRead: true, canReadAvailability: false, canCreate: false, canUpdate: false, canCancel: false, canManage: false, canSubscribe: true };
  const saved = await createSiteKey(deps, actor, { name: "Lock order", permissions: [], calendarPermissions: [grant] });
  const created = await call("createCalendarSubscription", { calendarId: small, name: "Lock order", endpoint: "https://receiver.example.test/lock-order", eventTypes: ["booking.created"], idempotencyKey: k() }, { kind: "key", secret: saved.secret });
  let edit: Promise<unknown> | undefined;
  try {
    await db.transaction(async tx => {
      await tx.select().from(calendars).where(eq(calendars.id, small)).for("update");
      edit = updateSiteKey(deps, actor, saved.key.id, { name: "Move grant", permissions: [], calendarPermissions: [{ ...grant, calendarId: large }] });
      await new Promise(resolve => setTimeout(resolve, 50));
      await tx.execute(sql`SET LOCAL lock_timeout = '500ms'`);
      // If the Key edit held the new target first, this would time out while it waits for our old target.
      await tx.select().from(calendars).where(eq(calendars.id, large)).for("update");
    });
  } finally { await edit; }
  const current = await call("getCalendarSubscription", { calendarId: small, subscriptionId: created.subscription.id });
  assert.equal(current.status, "paused"); assert.equal(current.version, 2);
});
test("rotation preserves uncertainty of an unfinished attempt while preventing any old-secret retry", async () => {
  const subscription = await subscribe("uncertain-rotation"); await booking();
  const [delivery] = (await logs(subscription)).items;
  await db.update(calendarDeliveries).set({ status: "delivering", attemptCount: 1, cycleAttempts: 1, claimToken: k(), claimUntil: new Date(+now + 60000) }).where(eq(calendarDeliveries.id, delivery.id));
  await db.insert(calendarDeliveryAttempts).values({ deliveryId: delivery.id, attempt: 1, startedAt: now });
  const rotated = await call("rotateCalendarSubscriptionSecret", { calendarId, subscriptionId: subscription.id, expectedVersion: 1, idempotencyKey: k() });
  const history = await call("getCalendarDelivery", { calendarId, subscriptionId: subscription.id, deliveryId: delivery.id });
  assert.equal(history.delivery.status, "skipped"); assert.equal(history.attempts[0].status, "unknown"); assert.equal(history.attempts[0].error, "outcome_unknown");
  await dispatchCalendarDeliveries(deps); assert.equal(received.filter(v => v.path === "/uncertain-rotation").length, 0);
  await assert.rejects(call("retryCalendarDelivery", { calendarId, subscriptionId: subscription.id, deliveryId: delivery.id, expectedVersion: 2, idempotencyKey: k() }), code("INVALID_STATE"));
  await revoke(rotated.subscription);
});
