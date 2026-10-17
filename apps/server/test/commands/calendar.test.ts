import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../../src/business/db/factory.js";
import { organization, user, member, workspaces, bookings, calendarPeople, calendarReceipts } from "../../src/business/db/schema.js";
import type { CommandDependencies } from "../../src/business/dependencies.js";
import { executeCalendar, type CalendarCaller } from "../../src/business/calendar/service.js";
import { CalendarError } from "../../src/business/calendar/errors.js";
import * as cmds from "../../src/business/commands/index.js";
import type { CalendarCommand, CalendarCommands, WorkingWindow } from "@tabdo/shared";
import { createSiteKey, updateSiteKey, deleteSiteKey } from "../../src/business/data-api/keys.js";
import type { Actor } from "../../src/business/auth/actor.js";
import { openIntervals, parseBookingTime } from "../../src/business/calendar/time.js";

const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test"));
assert.equal(process.env.DATABASE_URL_UNPOOLED, url, "Both URLs must name the same isolated database");
const resource = createDatabase({ connectionString: url, poolMax: 8 });
// A separate pool proves races cross independent PostgreSQL connections.
const other = createDatabase({ connectionString: url, poolMax: 4 });
const org = randomUUID(), uid = randomUUID(), mid = randomUUID(), agentId = randomUUID(), regularId = randomUUID();
const deps: CommandDependencies = { database: resource.db, now: () => new Date("2029-01-01T00:00:00Z"), uuid: randomUUID, automationQueueName: "unused" };
let a: CommandDependencies, b: CommandDependencies;
const caller: CalendarCaller = { kind: "member", organizationId: org, actorId: uid };
const actor: Actor = { kind: "human", organizationId: org, userId: uid, memberId: mid, role: "owner", name: "Calendar test", email: `${uid}@local.test` };
const scope = { organizationId: org, actorId: uid };
let calendarId: string, secondCalendar: string, personId: string;
const k = () => randomUUID();
const windows: WorkingWindow[] = [1, 2, 3, 4, 5, 6, 7].map(day => ({ day, start: "09:00", end: "17:00" }));
const time = (start: string, end: string, day = "2030-01-07") => ({ start: `${day}T${start}:00+08:00`, end: `${day}T${end}:00+08:00`, timeZone: "Asia/Shanghai" });
const call = <K extends CalendarCommand>(command: K, input: CalendarCommands[K], bound = a, who: CalendarCaller = caller) => executeCalendar(bound, who, command, input);
const code = (expected: string) => (cause: unknown) => cause instanceof CalendarError && cause.code === expected;
const create = (start: string, end: string, options: Partial<CalendarCommands["createBooking"]> = {}, bound = a) => call("createBooking", { calendarId, personId, title: "Private customer", time: time(start, end), idempotencyKey: k(), ...options }, bound);

before(async () => {
  await resource.db.insert(organization).values({ id: org, name: "Calendar test", slug: org });
  await resource.db.insert(user).values([{ id: uid, name: "Owner", email: actor.email }, { id: agentId, name: "Agent", email: `${agentId}@local.test`, kind: "agent" }, { id: regularId, name: "Member", email: `${regularId}@local.test` }]);
  await resource.db.insert(member).values([{ id: mid, organizationId: org, userId: uid, role: "owner" }, { id: k(), organizationId: org, userId: agentId, role: "member" }, { id: k(), organizationId: org, userId: regularId, role: "member" }]);
  const [workspace] = await resource.db.select().from(workspaces).where(eq(workspaces.organizationId, org));
  a = { ...deps, workspaceId: workspace.id };
  b = { ...deps, workspaceId: (await cmds.createWorkspace(deps, { ...scope, name: "Other workspace" })).id };
  calendarId = (await call("createCalendar", { name: "Clinic", timeZone: "Asia/Shanghai", idempotencyKey: k() })).id;
  secondCalendar = (await call("createCalendar", { name: "Private calendar", timeZone: "Asia/Shanghai", idempotencyKey: k() })).id;
  const person = await call("createCalendarPerson", { calendarId, name: "Dentist", timeZone: "Asia/Shanghai", userId: uid, idempotencyKey: k() });
  personId = person.id;
  await call("setWorkingHours", { calendarId, personId, expectedVersion: 1, windows, idempotencyKey: k() });
});
after(async () => {
  await resource.db.delete(organization).where(eq(organization.id, org));
  for (const id of [uid, agentId, regularId]) await resource.db.delete(user).where(eq(user.id, id));
  await other.close(); await resource.close();
});

test("real independent connections reject a concurrent double booking, allow adjacency and cross-calendar conflict", async () => {
  const racing = await Promise.allSettled([create("09:00", "09:30"), create("09:00", "09:30", {}, { ...a, database: other.db })]);
  assert.equal(racing.filter(result => result.status === "fulfilled").length, 1);
  const rejected = racing.find(result => result.status === "rejected")! as PromiseRejectedResult;
  assert(code("RESOURCE_CONFLICT")(rejected.reason));
  await create("09:30", "10:00");
  await assert.rejects(create("09:15", "09:45", { calendarId: secondCalendar }), code("RESOURCE_CONFLICT"));
});
test("failed reschedule preserves old time, CAS protects writes, cancellation releases availability and increments revision", async () => {
  const booking = await create("10:00", "10:30");
  await assert.rejects(call("rescheduleBooking", { calendarId, bookingId: booking.id, expectedVersion: booking.version, time: time("09:00", "09:30"), idempotencyKey: k() }), code("RESOURCE_CONFLICT"));
  assert.equal((await call("getBooking", { calendarId, bookingId: booking.id })).start, "2030-01-07T02:00:00.000Z");
  await assert.rejects(call("cancelBooking", { calendarId, bookingId: booking.id, expectedVersion: 9, idempotencyKey: k() }), code("VERSION_CONFLICT"));
  const cancelled = await call("cancelBooking", { calendarId, bookingId: booking.id, expectedVersion: 1, idempotencyKey: k() });
  assert.equal(cancelled.revision, 2);
  assert((await call("checkBookingConflicts", { calendarId, personId, time: time("10:00", "10:30") })).available);
  await assert.rejects(call("rescheduleBooking", { calendarId, bookingId: booking.id, expectedVersion: 2, time: time("10:30", "11:00"), idempotencyKey: k() }), code("INVALID_STATE"));
});
test("idempotency reserves absent keys in the same transaction, mismatch fails and revoked keys cannot replay", async () => {
  const input = { calendarId, personId, title: "Idempotent", time: time("11:00", "11:30"), idempotencyKey: k() };
  const results = await Promise.all([call("createBooking", input), call("createBooking", input, { ...a, database: other.db })]);
  assert.deepEqual(results[0], results[1]);
  assert.equal((await resource.db.select().from(bookings).where(eq(bookings.id, results[0].id))).length, 1);
  await assert.rejects(call("createBooking", { ...input, title: "Changed" }), code("IDEMPOTENCY_MISMATCH"));
  const grant = { calendarId, canRead: false, canReadAvailability: false, canCreate: true, canUpdate: false, canCancel: false, canManage: false };
  const key = await createSiteKey(a, actor, { name: "Create only", permissions: [], calendarPermissions: [grant] });
  const keyCaller: CalendarCaller = { kind: "key", secret: key.secret };
  const accepted = await call("createBooking", { ...input, time: time("11:30", "12:00"), idempotencyKey: k() }, a, keyCaller);
  assert.deepEqual(Object.keys(accepted).sort(), ["id", "revision", "status", "version"]);
  await assert.rejects(call("getBooking", { calendarId, bookingId: accepted.id }, a, keyCaller), code("FORBIDDEN"));
  await deleteSiteKey(a, actor, key.key.id);
  await assert.rejects(call("createBooking", input, a, keyCaller), /Invalid API key/);
});
test("working hours and time-off edits participate in the person lock protocol and roll back on existing bookings", async () => {
  const person = await call("getCalendarPerson", { calendarId, personId });
  await assert.rejects(call("setWorkingHours", { calendarId, personId, expectedVersion: person.version, windows: [], idempotencyKey: k() }), code("RESOURCE_CONFLICT"));
  assert.deepEqual((await call("getWorkingHours", { calendarId, personId })).windows, windows);
  await assert.rejects(call("setAvailabilityException", { calendarId, personId, date: "2030-01-07", intervals: [{ start: "09:00", end: "12:00" }], idempotencyKey: k() }), code("RESOURCE_CONFLICT"));
  const rest = await call("setAvailabilityException", { calendarId, personId, date: "2030-01-07", intervals: [{ start: "12:00", end: "13:00" }], idempotencyKey: k() });
  await assert.rejects(create("12:00", "12:30"), code("OUTSIDE_AVAILABILITY"));
  const edited = await call("setAvailabilityException", { calendarId, personId, exceptionId: rest.id, expectedVersion: 1, date: rest.date, intervals: [{ start: "12:00", end: "12:30" }], idempotencyKey: k() });
  assert.equal(edited.version, 2);
  await call("removeAvailabilityException", { calendarId, personId, exceptionId: rest.id, expectedVersion: 2, idempotencyKey: k() });
  assert((await call("checkBookingConflicts", { calendarId, personId, time: time("12:00", "12:30") })).available);
  const fresh = await call("createCalendarPerson", { calendarId, name: "Concurrent hours", timeZone: "Asia/Shanghai", idempotencyKey: k() });
  await call("setWorkingHours", { calendarId, personId: fresh.id, expectedVersion: 1, windows, idempotencyKey: k() });
  const races = await Promise.allSettled([
    create("12:00", "12:30", { personId: fresh.id }, { ...a, database: other.db }),
    call("setWorkingHours", { calendarId: secondCalendar, personId: fresh.id, expectedVersion: 2, windows: [], idempotencyKey: k() }),
  ]);
  assert.equal(races.filter(result => result.status === "fulfilled").length, 1);
  const final = await call("getCalendarPerson", { calendarId, personId: fresh.id });
  const booked = (await call("queryBookings", { calendarId, personId: fresh.id, rangeStart: "2030-01-07T00:00:00Z", rangeEnd: "2030-01-08T00:00:00Z" })).items;
  assert(final.windows.length > 0 || booked.length === 0);
});
test("atomic business batch validates final state, supports swaps and rolls back every booking/receipt on one failure", async () => {
  const first = await create("13:00", "13:30"), second = await create("13:30", "14:00");
  const result = await call("batchBookings", { calendarId, idempotencyKey: k(), operations: [
    { kind: "reschedule", bookingId: first.id, expectedVersion: 1, time: time("13:30", "14:00") },
    { kind: "reschedule", bookingId: second.id, expectedVersion: 1, time: time("13:00", "13:30") },
  ] }); assert.equal(result.receipts.length, 2);
  const failedKey = k();
  await assert.rejects(call("batchBookings", { calendarId, idempotencyKey: failedKey, operations: [
    { kind: "cancel", bookingId: first.id, expectedVersion: 2 },
    { kind: "create", personId, title: "Conflict", time: time("13:00", "13:30") },
  ] }), code("RESOURCE_CONFLICT"));
  assert.equal((await call("getBooking", { calendarId, bookingId: first.id })).status, "confirmed");
  assert.equal((await resource.db.select().from(calendarReceipts).where(and(eq(calendarReceipts.workspaceId, a.workspaceId!), eq(calendarReceipts.key, failedKey)))).length, 0);
});
test("workspace identity, live membership and explicit key capabilities cannot leak other bookings", async () => {
  await assert.rejects(call("getCalendar", { calendarId }, b), code("NOT_FOUND"));
  await assert.rejects(call("createCalendarPerson", { calendarId, name: "Duplicate", userId: uid, timeZone: "UTC", idempotencyKey: k() }), code("RESOURCE_CONFLICT"));
  await assert.rejects(call("createCalendarPerson", { calendarId, name: "AI dentist", userId: agentId, timeZone: "UTC", idempotencyKey: k() }), code("BAD_INPUT"));
  for (const actorId of [regularId, agentId]) await assert.rejects(call("createCalendar", { name: "Forbidden", timeZone: "UTC", idempotencyKey: k() }, a, { kind: "member", organizationId: org, actorId }), code("FORBIDDEN"));
  const table = await cmds.createTable(a, { ...scope, name: "Legacy grant" });
  const oldKey = await createSiteKey(a, actor, { name: "Table only", permissions: [{ tableId: table.id, canRead: true, canCreate: false, canUpdate: false, canDelete: false }] });
  assert.equal((await call("listCalendars", {}, a, { kind: "key", secret: oldKey.secret })).items.length, 0);
  const key = await createSiteKey(a, actor, { name: "Availability", permissions: [], calendarPermissions: [{ calendarId, canRead: false, canReadAvailability: true, canCreate: false, canUpdate: false, canCancel: false, canManage: false }] });
  const keyCaller: CalendarCaller = { kind: "key", secret: key.secret };
  const availability = await call("queryAvailability", { calendarId, personId, rangeStart: "2030-01-07T00:00:00Z", rangeEnd: "2030-01-08T00:00:00Z", durationMinutes: 30 }, a, keyCaller);
  assert(availability.complete); assert(!JSON.stringify(availability).includes("Private customer"));
  const labels = await call("listCalendarPeople", { calendarId }, a, keyCaller);
  assert.equal(labels.items.find(person => person.id === personId)?.userId, null, "Availability directory excludes member binding identifiers");
  assert(!availability.slots.some(slot => slot.start === "2030-01-07T01:00:00.000Z"));
  await assert.rejects(call("queryBookings", { calendarId, rangeStart: "2030-01-07T00:00:00Z", rangeEnd: "2030-01-08T00:00:00Z" }, a, keyCaller), code("FORBIDDEN"));
  await assert.rejects(call("queryAvailability", { calendarId: secondCalendar, personId, rangeStart: "2030-01-07T00:00:00Z", rangeEnd: "2030-01-08T00:00:00Z", durationMinutes: 30 }, a, keyCaller), code("NOT_FOUND"));
  await updateSiteKey(a, actor, key.key.id, { name: "Removed calendar", permissions: [{ tableId: table.id, canRead: true, canCreate: false, canUpdate: false, canDelete: false }], calendarPermissions: [] });
  await assert.rejects(call("queryAvailability", { calendarId, personId, rangeStart: "2030-01-07T00:00:00Z", rangeEnd: "2030-01-08T00:00:00Z", durationMinutes: 30 }, a, keyCaller), code("NOT_FOUND"));
  const calendarB = await call("createCalendar", { name: "B", timeZone: "Asia/Shanghai", idempotencyKey: k() }, b);
  const personB = await call("createCalendarPerson", { calendarId: calendarB.id, name: "Same human, other workspace", timeZone: "Asia/Shanghai", userId: uid, idempotencyKey: k() }, b);
  await call("setWorkingHours", { calendarId: calendarB.id, personId: personB.id, windows, expectedVersion: 1, idempotencyKey: k() }, b);
  await create("09:00", "09:30", { calendarId: calendarB.id, personId: personB.id }, b);
  await assert.rejects(call("archiveCalendarPerson", { calendarId, personId, expectedVersion: 2, idempotencyKey: k() }), code("FUTURE_BOOKINGS"));
  await assert.rejects(call("archiveCalendar", { calendarId, expectedVersion: 1, idempotencyKey: k() }), code("FUTURE_BOOKINGS"));
});
test("range overlap includes events starting before window; strict bounded queries reject cursor replay and invalid dates", async () => {
  const result = await call("queryBookings", { calendarId, rangeStart: "2030-01-07T01:15:00Z", rangeEnd: "2030-01-07T01:20:00Z" });
  assert.equal(result.items.length, 1);
  await assert.rejects(executeCalendar(a, caller, "queryBookings", { calendarId, cursor: "forged", rangeStart: "2030-01-07T00:00:00Z", rangeEnd: "2030-01-08T00:00:00Z" }), code("BAD_INPUT"));
  await assert.rejects(call("setAvailabilityException", { calendarId, personId, date: "2030-02-30", intervals: [{ start: "00:00", end: "24:00" }], idempotencyKey: k() }), code("BAD_INPUT"));
  await assert.rejects(call("queryAvailability", { calendarId, personId, rangeStart: "2030-01-01T00:00:00Z", rangeEnd: "2031-01-01T00:00:00Z", durationMinutes: 30 }), code("BAD_INPUT"));
});
test("DST gaps reject invalid offsets; both fall-back offsets are bookable only where actual local minutes are open", () => {
  assert.throws(() => parseBookingTime({ start: "2030-03-10T02:15:00-05:00", end: "2030-03-10T03:45:00-04:00", timeZone: "America/New_York" }), code("BAD_INPUT"));
  assert.throws(() => parseBookingTime({ start: "2030-02-30T10:00:00Z", end: "2030-02-30T10:30:00Z", timeZone: "UTC" }), code("BAD_INPUT"));
  const open = openIntervals("America/New_York", [{ day: 7, start: "01:15", end: "01:45" }], [], { start: Date.parse("2030-11-03T04:00:00Z"), end: Date.parse("2030-11-03T08:00:00Z") });
  assert.deepEqual(open.map(slot => [new Date(slot.start).toISOString(), new Date(slot.end).toISOString()]), [["2030-11-03T05:15:00.000Z", "2030-11-03T05:45:00.000Z"], ["2030-11-03T06:15:00.000Z", "2030-11-03T06:45:00.000Z"]]);
});

test("stable person locks also prevent empty-slot races across different calendars", async () => {
  const person = await call("createCalendarPerson", { calendarId, name: "Across calendars", timeZone: "Asia/Shanghai", idempotencyKey: k() });
  await call("setWorkingHours", { calendarId, personId: person.id, expectedVersion: 1, windows, idempotencyKey: k() });
  const results = await Promise.allSettled([
    create("15:00", "15:30", { personId: person.id }),
    create("15:00", "15:30", { calendarId: secondCalendar, personId: person.id }, { ...a, database: other.db }),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert(code("RESOURCE_CONFLICT")((results.find(result => result.status === "rejected") as PromiseRejectedResult).reason));
});
test("unscoped creation reserves an absent receipt concurrently; archive retries return the safe original receipt", async () => {
  const input = { name: "Same absent receipt", timeZone: "UTC", idempotencyKey: k() };
  const results = await Promise.all([call("createCalendar", input), call("createCalendar", input, { ...a, database: other.db })]);
  assert.deepEqual(results[0], results[1]);
  const archive = { calendarId: results[0].id, expectedVersion: 1, idempotencyKey: k() };
  const archived = await call("archiveCalendar", archive); assert(archived.archived);
  assert.deepEqual(await call("archiveCalendar", archive), archived);
});
test("bound human uniqueness is enforced under concurrent calendar creation and returns a safe conflict code", async () => {
  const boundUser = randomUUID();
  await resource.db.insert(user).values({ id: boundUser, name: "Concurrent human", email: `${boundUser}@local.test` });
  await resource.db.insert(member).values({ id: k(), organizationId: org, userId: boundUser, role: "member" });
  try {
    const input = { calendarId, name: "Human", userId: boundUser, timeZone: "UTC", idempotencyKey: k() };
    const result = await Promise.allSettled([call("createCalendarPerson", input), call("createCalendarPerson", { ...input, calendarId: secondCalendar, idempotencyKey: k() }, { ...a, database: other.db })]);
    assert.equal(result.filter(item => item.status === "fulfilled").length, 1);
    assert(code("RESOURCE_CONFLICT")((result.find(item => item.status === "rejected") as PromiseRejectedResult).reason));
  } finally {
    await resource.db.delete(calendarPeople).where(eq(calendarPeople.userId, boundUser));
    await resource.db.delete(user).where(eq(user.id, boundUser));
  }
});

test("range queries fail explicitly above 500 while availability subtracts the complete occupied set", async () => {
  const person = await call("createCalendarPerson", { calendarId, name: "Bounded query", timeZone: "Asia/Shanghai", idempotencyKey: k() });
  await call("setWorkingHours", { calendarId, personId: person.id, expectedVersion: 1, windows, idempotencyKey: k() });
  await resource.db.insert(bookings).values(Array.from({ length: 501 }, (_, index) => {
    const start = new Date(Date.parse(index < 480 ? "2030-01-09T01:00:00Z" : "2030-01-10T01:00:00Z") + (index % 480) * 60000);
    return { workspaceId: a.workspaceId!, calendarId, personId: person.id, title: "Occupied minute", start, end: new Date(+start + 60000), timeZone: "UTC" };
  }));
  const range = { rangeStart: "2030-01-09T01:00:00Z", rangeEnd: "2030-01-10T09:00:00Z" };
  await assert.rejects(call("queryBookings", { calendarId, personId: person.id, ...range }), code("QUERY_LIMIT"));
  const available = await call("queryAvailability", { calendarId, personId: person.id, ...range, durationMinutes: 1, stepMinutes: 1 });
  assert(available.complete); assert.equal(available.slots.length, 459);
  assert.equal(available.slots[0].start, "2030-01-10T01:21:00.000Z");
});
test("migration constraints reject cross-workspace allocations and calendar scope moves", async () => {
  const foreign = await call("createCalendar", { name: "Foreign allocation", timeZone: "UTC", idempotencyKey: k() }, b);
  const person = await call("createCalendarPerson", { calendarId: foreign.id, name: "Other person", timeZone: "UTC", idempotencyKey: k() }, b);
  await assert.rejects(resource.db.insert(bookings).values({ workspaceId: a.workspaceId!, calendarId, personId: person.id, title: "Forged", start: new Date("2030-01-07T09:00:00Z"), end: new Date("2030-01-07T09:30:00Z"), timeZone: "UTC" }));
  const { calendars } = await import("../../src/business/db/schema.js");
  await assert.rejects(resource.db.update(calendars).set({ workspaceId: b.workspaceId }).where(eq(calendars.id, calendarId)));
});
