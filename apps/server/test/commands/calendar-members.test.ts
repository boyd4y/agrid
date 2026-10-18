import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../../src/business/db/factory.js";
import { organization, user, member, workspaces, calendarPeople, bookings, calendarReceipts, calendarEvents } from "../../src/business/db/schema.js";
import { executeCalendar, type CalendarCaller } from "../../src/business/calendar/service.js";
import { CalendarError } from "../../src/business/calendar/errors.js";
import type { CommandDependencies } from "../../src/business/dependencies.js";
import type { CalendarCommand, CalendarCommands } from "@tabdo/shared";
import { createSiteKey, deleteSiteKey } from "../../src/business/data-api/keys.js";
import type { Actor } from "../../src/business/auth/actor.js";

const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test")); assert.equal(process.env.DATABASE_URL_UNPOOLED, url);
const db = createDatabase({ connectionString: url, poolMax: 8 }), other = createDatabase({ connectionString: url, poolMax: 4 });
const k = randomUUID, org = k(), owner = k(), human = k(), agent = k(), outsider = k(), ownerMember = k();
const caller: CalendarCaller = { kind: "member", organizationId: org, actorId: owner };
const deps: CommandDependencies = { database: db.db, now: () => new Date("2029-01-01T00:00:00Z"), uuid: k, automationQueueName: "unused" };
let bound: CommandDependencies, alternate: CommandDependencies, calendarId: string, second: string;
const call = <K extends CalendarCommand>(command: K, input: CalendarCommands[K], d = bound, who: CalendarCaller = caller) => executeCalendar(d, who, command, input);
const code = (expected: string) => (error: unknown) => error instanceof CalendarError && error.code === expected;
const time = (hour: number, day = "2030-01-07") => ({ start: `${day}T${String(hour).padStart(2, "0")}:00:00Z`, end: `${day}T${String(hour).padStart(2, "0")}:30:00Z`, timeZone: "UTC" });
const create = (userId: string, hour: number, extra = {}) => call("createBooking", { calendarId, userId, title: "Member event", time: time(hour), idempotencyKey: k(), ...extra });
const get = (id: string) => call("getBooking", { calendarId, bookingId: id });
before(async () => {
  await db.db.insert(organization).values({ id: org, name: "Members", slug: org });
  await db.db.insert(user).values([owner, human, agent, outsider].map(id => ({ id, name: "Same name", email: `${id}@local.test`, kind: id === agent ? "agent" as const : "human" as const })));
  await db.db.insert(member).values([owner, human, agent].map(id => ({ id: id === owner ? ownerMember : k(), organizationId: org, userId: id, role: id === owner ? "owner" : "member" })));
  const [workspace] = await db.db.select().from(workspaces).where(eq(workspaces.organizationId, org));
  bound = { ...deps, workspaceId: workspace.id }; alternate = { ...bound, database: other.db };
  calendarId = (await call("createCalendar", { name: "Events", timeZone: "UTC", idempotencyKey: k() })).id;
  second = (await call("createCalendar", { name: "Other calendar", timeZone: "UTC", idempotencyKey: k() })).id;
});
after(async () => {
  await db.db.delete(organization).where(eq(organization.id, org));
  for (const id of [owner, human, agent, outsider]) await db.db.delete(user).where(eq(user.id, id));
  await other.close(); await db.close();
});
test("member directory is read-only, preserves same-name identities and includes agents", async () => {
  const before = await db.db.select().from(calendarPeople).where(eq(calendarPeople.workspaceId, bound.workspaceId!));
  const directory = await call("listCalendarMembers", { calendarId });
  assert.deepEqual(new Set(directory.items.map(m => m.userId)), new Set([owner, human, agent]));
  assert.equal(directory.items.find(m => m.userId === agent)?.kind, "agent");
  assert.deepEqual(await db.db.select().from(calendarPeople).where(eq(calendarPeople.workspaceId, bound.workspaceId!)), before);
});
test("concurrent first use maps one identity; no working hours required; conflicts cross calendars", async () => {
  const input = { calendarId, userId: agent, title: "Agent", time: time(1), idempotencyKey: k() };
  const replay = await Promise.all([call("createBooking", input), call("createBooking", input, alternate)]);
  assert.deepEqual(replay[0], replay[1]);
  const stored = await get(replay[0].id); assert.equal(stored.userId, agent); assert.equal(stored.schedulingMode, "member");
  assert.deepEqual((await call("getCalendarPerson", { calendarId, personId: stored.personId })).windows, []);
  const race = await Promise.allSettled([create(human, 2), call("createBooking", { ...input, calendarId: second, userId: human, time: time(2), idempotencyKey: k() }, alternate)]);
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
  assert(code("RESOURCE_CONFLICT")((race.find(r => r.status === "rejected") as PromiseRejectedResult).reason));
  assert.equal((await db.db.select().from(calendarPeople).where(and(eq(calendarPeople.workspaceId, bound.workspaceId!), eq(calendarPeople.userId, human)))).length, 1);
  await assert.rejects(create(agent, 1, { calendarId: second }), code("RESOURCE_CONFLICT"));
  await assert.rejects(call("createBooking", { ...input, title: "Mismatch" }), code("IDEMPOTENCY_MISMATCH"));
});
test("bound historical person is reused, ordinary events skip hours while legacy bookings retain them", async () => {
  const person = await call("createCalendarPerson", { calendarId, userId: owner, name: "Historical", timeZone: "UTC", idempotencyKey: k() });
  await call("setWorkingHours", { calendarId, personId: person.id, expectedVersion: 1, windows: [{ day: 1, start: "09:00", end: "17:00" }], idempotencyKey: k() });
  const event = await create(owner, 3); assert.equal((await get(event.id)).personId, person.id);
  await assert.rejects(call("createBooking", { calendarId, personId: person.id, title: "Legacy", time: time(4), idempotencyKey: k() }), code("OUTSIDE_AVAILABILITY"));
  const legacy = await call("createBooking", { calendarId, personId: person.id, title: "Legacy", time: time(9), idempotencyKey: k() });
  await assert.rejects(create(owner, 9), code("RESOURCE_CONFLICT"));
  await assert.rejects(call("rescheduleBooking", { calendarId, bookingId: legacy.id, expectedVersion: 1, time: time(4), idempotencyKey: k() }), code("OUTSIDE_AVAILABILITY"));
  await assert.rejects(call("rescheduleBooking", { calendarId, bookingId: legacy.id, expectedVersion: 1, time: time(10), userId: agent, idempotencyKey: k() }), code("BAD_INPUT"));
  const changed = await call("rescheduleBooking", { calendarId, bookingId: event.id, expectedVersion: 1, time: time(4), title: "Edited title", userId: agent, idempotencyKey: k() });
  assert.equal(changed.revision, 2); assert.equal((await get(event.id)).title, "Edited title"); assert.equal((await get(event.id)).userId, agent);
  await assert.rejects(call("cancelBooking", { calendarId, bookingId: event.id, expectedVersion: 1, idempotencyKey: k() }), code("VERSION_CONFLICT"));
  const cancelled = await call("cancelBooking", { calendarId, bookingId: event.id, expectedVersion: 2, idempotencyKey: k() }); assert.equal(cancelled.revision, 3);
});
test("failed batches roll back new mappings, bookings, events and idempotency receipts", async () => {
  const fresh = k(); await db.db.insert(user).values({ id: fresh, name: "Batch", email: `${fresh}@local.test` });
  await db.db.insert(member).values({ id: k(), organizationId: org, userId: fresh, role: "member" });
  const idempotencyKey = k();
  try {
    const before = await db.db.select().from(calendarEvents).where(eq(calendarEvents.workspaceId, bound.workspaceId!));
    await assert.rejects(call("batchBookings", { calendarId, idempotencyKey, operations: [{ kind: "create", userId: fresh, title: "A", time: time(5) }, { kind: "create", userId: fresh, title: "B", time: time(5) }] }), code("RESOURCE_CONFLICT"));
    assert.equal((await db.db.select().from(calendarPeople).where(eq(calendarPeople.userId, fresh))).length, 0);
    assert.equal((await db.db.select().from(calendarReceipts).where(eq(calendarReceipts.key, idempotencyKey))).length, 0);
    assert.deepEqual(await db.db.select().from(calendarEvents).where(eq(calendarEvents.workspaceId, bound.workspaceId!)), before);
  } finally { await db.db.delete(member).where(eq(member.userId, fresh)); await db.db.delete(user).where(eq(user.id, fresh)); }
});
test("nonmembers and another workspace cannot be used; leaving blocks edits but permits historical read/cancel", async () => {
  await assert.rejects(create(outsider, 6), code("BAD_INPUT"));
  await assert.rejects(call("createBooking", { calendarId, userId: agent, title: "Wrong workspace", time: time(6), idempotencyKey: k() }, { ...bound, workspaceId: k() }), /工作区不可访问/);
  const event = await create(human, 6);
  const transferable = await create(human, 7);
  const [membership] = await db.db.delete(member).where(eq(member.userId, human)).returning();
  try {
    assert.equal((await get(event.id)).userId, human);
    assert(!(await call("listCalendarMembers", { calendarId })).items.some(m => m.userId === human));
    await assert.rejects(create(human, 7), code("BAD_INPUT"));
    await assert.rejects(call("rescheduleBooking", { calendarId, bookingId: event.id, expectedVersion: 1, time: time(7), idempotencyKey: k() }), code("INVALID_STATE"));
    await call("rescheduleBooking", { calendarId, bookingId: transferable.id, expectedVersion: 1, time: time(7), userId: agent, idempotencyKey: k() });
    assert.equal((await get(transferable.id)).userId, agent);
    await call("cancelBooking", { calendarId, bookingId: event.id, expectedVersion: 1, idempotencyKey: k() });
    assert.equal((await get(event.id)).status, "cancelled");
  } finally { await db.db.insert(member).values(membership); }
});
test("create-only key can choose members but cannot read event details or bypass operation grants", async () => {
  const actor: Actor = { kind: "human", organizationId: org, userId: owner, memberId: ownerMember, role: "owner", name: "Owner", email: `${owner}@local.test` };
  const key = await createSiteKey(bound, actor, { name: "Events only", permissions: [], calendarPermissions: [{ calendarId, canRead: false, canReadAvailability: false, canCreate: true, canUpdate: false, canCancel: false, canManage: false }] });
  const who: CalendarCaller = { kind: "key", secret: key.secret };
  assert((await call("listCalendarMembers", { calendarId }, bound, who)).items.some(m => m.userId === agent));
  const created = await call("createBooking", { calendarId, userId: agent, title: "Key event", time: time(8), idempotencyKey: k() }, bound, who);
  assert.deepEqual(Object.keys(created).sort(), ["id", "revision", "status", "version"]);
  await assert.rejects(call("getBooking", { calendarId, bookingId: created.id }, bound, who), code("FORBIDDEN"));
  await assert.rejects(call("listCalendarMembers", { calendarId: second }, bound, who), code("NOT_FOUND"));
  await assert.rejects(call("cancelBooking", { calendarId, bookingId: created.id, expectedVersion: 1, idempotencyKey: k() }, bound, who), code("FORBIDDEN"));
  await deleteSiteKey(bound, actor, key.key.id);
  await assert.rejects(call("createBooking", { calendarId, userId: agent, title: "Revoked", time: time(10), idempotencyKey: k() }, bound, who), /Invalid API key/);
});

test("archived historical mappings do not become a setup requirement for active members", async () => {
  const id = k();
  await db.db.insert(user).values({ id, name: "Archived mapping", email: `${id}@local.test` });
  await db.db.insert(member).values({ id: k(), organizationId: org, userId: id, role: "member" });
  try {
    const person = await call("createCalendarPerson", { calendarId, userId: id, name: "Historical", timeZone: "UTC", idempotencyKey: k() });
    await call("archiveCalendarPerson", { calendarId, personId: person.id, expectedVersion: 1, idempotencyKey: k() });
    const event = await create(id, 20); assert.equal((await get(event.id)).personId, person.id);
    await assert.rejects(call("createBooking", { calendarId, personId: person.id, title: "Legacy archived", time: time(21), idempotencyKey: k() }), code("ARCHIVED"));
    const saved = await call("setWorkingHours", { calendarId, personId: person.id, expectedVersion: 2, windows: [], idempotencyKey: k() });
    assert(saved.archived); assert.equal((await get(event.id)).status, "confirmed");
  } finally {
    await db.db.delete(calendarPeople).where(eq(calendarPeople.userId, id));
    await db.db.delete(member).where(eq(member.userId, id)); await db.db.delete(user).where(eq(user.id, id));
  }
});
