import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { CALENDAR_PERMISSION_OPERATIONS, type CalendarCommand, type CalendarPermission } from "@tabdo/shared";
import { createDatabase } from "../../src/business/db/factory.js";
import { organization, user, member, workspaces, apiKeyCalendars, userApiKeys } from "../../src/business/db/schema.js";
import { executeCalendar, type CalendarCaller } from "../../src/business/calendar/service.js";
import { createSiteKey, updateSiteKey, deleteSiteKey } from "../../src/business/data-api/keys.js";
import type { Actor } from "../../src/business/auth/actor.js";
import type { CommandDependencies } from "../../src/business/dependencies.js";

const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test")); assert.equal(process.env.DATABASE_URL_UNPOOLED, url);
const resource = createDatabase({ connectionString: url, poolMax: 5 }), db = resource.db;
const org = randomUUID(), uid = randomUUID(), regular = randomUUID(), foreignOrg = randomUUID();
const actor: Actor = { kind: "human", organizationId: org, userId: uid, memberId: randomUUID(), role: "owner", name: "CRUD owner", email: `${uid}@local.test` };
const owner: CalendarCaller = { kind: "member", organizationId: org, actorId: uid };
let deps: CommandDependencies, calendarId: string, secondCalendar: string, foreignCalendar: string, personId: string;
const k = randomUUID;
const call = (who: CalendarCaller, command: CalendarCommand, input: unknown) => executeCalendar(deps, who, command, input) as Promise<any>;
const grant = (operation: typeof CALENDAR_PERMISSION_OPERATIONS[number]): CalendarPermission => ({ calendarId, canRead: false, canUpdate: false, canDelete: false, canCreate: false, [operation]: true });
const forbidden = (error: any) => error.status === 403;
const time = { start: "2030-01-07T10:00:00Z", end: "2030-01-07T11:00:00Z", timeZone: "UTC" };
before(async () => {
  await db.insert(organization).values([{ id: org, name: "CRUD", slug: org }, { id: foreignOrg, name: "Foreign", slug: foreignOrg }]);
  await db.insert(user).values([{ id: uid, name: actor.name, email: actor.email }, { id: regular, name: "Regular", email: `${regular}@local.test` }]);
  await db.insert(member).values([{ id: actor.memberId, organizationId: org, userId: uid, role: "owner" }, { id: k(), organizationId: org, userId: regular, role: "member" }, { id: k(), organizationId: foreignOrg, userId: uid, role: "owner" }]);
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.organizationId, org));
  deps = { database: db, workspaceId: workspace.id, now: () => new Date("2029-01-01"), uuid: k, automationQueueName: "unused", calendarOutbound: { encryptionKey: "11".repeat(32), send: async () => ({ httpStatus: 204, error: null }) } };
  calendarId = (await call(owner, "createCalendar", { name: "CRUD calendar", timeZone: "UTC", idempotencyKey: k() })).id;
  secondCalendar = (await call(owner, "createCalendar", { name: "Unassigned", timeZone: "UTC", idempotencyKey: k() })).id;
  const [foreignWorkspace] = await db.select().from(workspaces).where(eq(workspaces.organizationId, foreignOrg));
  foreignCalendar = (await executeCalendar({ ...deps, workspaceId: foreignWorkspace.id }, { kind: "member", organizationId: foreignOrg, actorId: uid }, "createCalendar", { name: "Foreign", timeZone: "UTC", idempotencyKey: k() })).id;
  personId = (await call(owner, "createCalendarPerson", { calendarId, name: "Person", timeZone: "UTC", idempotencyKey: k() })).id;
  await call(owner, "setWorkingHours", { calendarId, personId, expectedVersion: 1, windows: [{ day: 1, start: "00:00", end: "24:00" }], idempotencyKey: k() });
});
after(async () => { await db.delete(organization).where(inArray(organization.id, [org, foreignOrg])); await db.delete(user).where(inArray(user.id, [uid, regular])); await resource.close(); });

test("each public CRUD flag independently permits its command and rejects the other three, including batch items and replay", async () => {
  for (const operation of CALENDAR_PERMISSION_OPERATIONS) {
    const saved = await createSiteKey(deps, actor, { name: operation, permissions: [], calendarPermissions: [grant(operation)] });
    assert.deepEqual(saved.key.calendarPermissions, [grant(operation)]);
    const who: CalendarCaller = { kind: "key", secret: saved.secret };
    const booking = await call(owner, "createBooking", { calendarId, userId: regular, title: "Boundary", time, idempotencyKey: k() });
    const current = await call(owner, "getCalendar", { calendarId });
    const examples: Record<typeof operation, [CalendarCommand, unknown]> = {
      canRead: ["queryAvailability", { calendarId, personId, rangeStart: "2030-01-07T00:00:00Z", rangeEnd: "2030-01-08T00:00:00Z", durationMinutes: 30 }],
      canUpdate: ["updateCalendar", { calendarId, expectedVersion: current.version, name: "Updated", timeZone: "UTC", idempotencyKey: k() }],
      canDelete: ["cancelBooking", { calendarId, bookingId: booking.id, expectedVersion: 1, idempotencyKey: k() }],
      canCreate: ["createCalendarPerson", { calendarId, name: "Created", timeZone: "UTC", idempotencyKey: k() }],
    };
    for (const [required, [command, input]] of Object.entries(examples)) {
      if (required === operation) await call(who, command, input);
      else await assert.rejects(call(who, command, input), forbidden);
    }
    const listed = await call(who, "listCalendars", {});
    assert.equal(listed.items.length, operation === "canRead" ? 1 : 0);
    if (operation !== "canDelete") await call(owner, "cancelBooking", { calendarId, bookingId: booking.id, expectedVersion: 1, idempotencyKey: k() });
    const batch = { calendarId, operations: [{ kind: "create", userId: uid, title: "Must roll back", time }, { kind: "cancel", bookingId: booking.id, expectedVersion: 1 }], idempotencyKey: k() };
    await assert.rejects(call(who, "batchBookings", batch), forbidden);
    await assert.rejects(call(who, "getCalendar", { calendarId: secondCalendar }), (e: any) => e.status === 404);
    await assert.rejects(call(who, "getCalendar", { calendarId: foreignCalendar }), (e: any) => e.status === 404);
    await deleteSiteKey(deps, actor, saved.key.id);
    await assert.rejects(call(who, ...examples[operation]), (e: any) => e.status === 401);
  }
  await assert.rejects(call({ kind: "member", organizationId: org, actorId: regular }, "updateCalendar", { calendarId, name: "No", timeZone: "UTC", expectedVersion: 1, idempotencyKey: k() }), forbidden);
});

test("legacy summaries and unrelated saves preserve exact capability rows; explicit CRUD edits touch only that group", async () => {
  const legacy = { calendarId, canRead: true, canReadAvailability: false, canCreate: false, canUpdate: false, canCancel: false, canManage: false };
  const saved = await createSiteKey(deps, actor, { name: "Legacy", permissions: [], calendarPermissions: [legacy] });
  const who: CalendarCaller = { kind: "key", secret: saved.secret };
  const rows = () => db.select().from(apiKeyCalendars).where(eq(apiKeyCalendars.keyId, saved.key.id));
  const before = await rows();
  assert.deepEqual(saved.key.calendarPermissions, [{ calendarId, canRead: false, canUpdate: false, canDelete: false, canCreate: false, partialOperations: ["canRead"] }]);
  await updateSiteKey(deps, actor, saved.key.id, { name: "Renamed", permissions: [], calendarPermissions: saved.key.calendarPermissions });
  assert.deepEqual(await rows(), before);
  await call(who, "getCalendar", { calendarId });
  await assert.rejects(call(who, "checkBookingConflicts", { calendarId, personId, time }), forbidden);
  await updateSiteKey(deps, actor, saved.key.id, { name: "Explicit update", permissions: [], calendarPermissions: [{ ...saved.key.calendarPermissions![0], canUpdate: true }] });
  assert.equal((await rows())[0].canRead, true);
  assert.deepEqual((await rows())[0].crudPermissions, { canUpdate: true });
  await assert.rejects(call(who, "checkBookingConflicts", { calendarId, personId, time }), forbidden);
  await assert.rejects(call(who, "archiveCalendar", { calendarId, expectedVersion: 1, idempotencyKey: k() }), forbidden);
  const edited = await updateSiteKey(deps, actor, saved.key.id, { name: "Clear partial Read", permissions: [], calendarPermissions: [{ calendarId, canRead: false, canUpdate: true, canDelete: false, canCreate: false }] });
  assert(!edited.key.calendarPermissions![0].partialOperations?.includes("canRead"));
  await assert.rejects(call(who, "getCalendar", { calendarId }), forbidden);
  await db.update(userApiKeys).set({ revokedAt: new Date() }).where(and(eq(userApiKeys.id, saved.key.id), eq(userApiKeys.organizationId, org)));
  await assert.rejects(call(who, "getCalendar", { calendarId }), (e: any) => e.status === 401);
});

test("revoking the last calendar grant saves an inert key while new empty keys are rejected", async () => {
  await assert.rejects(createSiteKey(deps, actor, { name: "Empty new", permissions: [], calendarPermissions: [] }));
  const saved = await createSiteKey(deps, actor, { name: "Last grant", permissions: [], calendarPermissions: [grant("canRead")] });
  const result = await updateSiteKey(deps, actor, saved.key.id, { name: "No grants", permissions: [], calendarPermissions: [] });
  assert.deepEqual(result.key.calendarPermissions, []);
  await assert.rejects(call({ kind: "key", secret: saved.secret }, "getCalendar", { calendarId }), (e: any) => e.status === 404);
});

test("availability-only legacy access remains visible as mixed Read, survives an unrelated save, and can be cleared", async () => {
  const legacy = { calendarId, canRead: false, canReadAvailability: true, canCreate: false, canUpdate: false, canCancel: false, canManage: false };
  const saved = await createSiteKey(deps, actor, { name: "Availability only", permissions: [], calendarPermissions: [legacy] });
  assert.deepEqual(saved.key.calendarPermissions![0].partialOperations, ["canRead"]);
  const input = { calendarId, personId, rangeStart: "2030-01-07T00:00:00Z", rangeEnd: "2030-01-08T00:00:00Z", durationMinutes: 30 };
  const who: CalendarCaller = { kind: "key", secret: saved.secret };
  await updateSiteKey(deps, actor, saved.key.id, { name: "Renamed availability", permissions: [], calendarPermissions: saved.key.calendarPermissions });
  await call(who, "queryAvailability", input);
  await assert.rejects(call(who, "getCalendar", { calendarId }), forbidden);
  await updateSiteKey(deps, actor, saved.key.id, { name: "Cleared", permissions: [], calendarPermissions: [] });
  await assert.rejects(call(who, "queryAvailability", input), (e: any) => e.status === 404);
});
