import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createTableTools } from "../../src/business/agent/tools/index.js";
import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createClient } from "@tabdo/sdk";
import { createDatabase } from "../../src/business/db/factory.js";
import { organization, user, member, agentProfile, workspaces, bookings, bookingReminderIntents, bookingReminders, automations, automationOccurrences, automationSchedules, automationEvents } from "../../src/business/db/schema.js";
import type { CommandDependencies } from "../../src/business/dependencies.js";
import { executeCalendar } from "../../src/business/calendar/service.js";
import { createAutomation, updateAutomation } from "../../src/business/automation/crud.js";
import { dispatchDueSchedules } from "../../src/business/automation/schedule.js";
import { appendExternalAutomationEvent } from "../../src/business/automation/events.js";
import { createSiteKey, updateSiteKey } from "../../src/business/data-api/keys.js";
import { createSiteApiRoutes } from "../../src/business/http/site-api.js";
import { createCommandsRoute } from "../../src/business/http/commands.js";
import { createCalendarTools } from "../../src/business/agent/tools/calendar.js";
import { acceptBookingReminder, dispatchDueBookingReminders } from "../../src/business/calendar/reminders.js";
import type { Actor } from "../../src/business/auth/actor.js";
import type { CalendarCommand, CalendarCommands, AutomationRule } from "@tabdo/shared";
const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test")); assert.equal(process.env.DATABASE_URL_UNPOOLED, url);
const resource = createDatabase({ connectionString: url, poolMax: 8 });
const other = createDatabase({ connectionString: url, poolMax: 2 });
const org = randomUUID(), uid = randomUUID(), mid = randomUUID(), aid = randomUUID(), am = randomUUID();
let now = new Date("2030-03-08T00:00:00Z");
let deps: CommandDependencies = { database: resource.db, now: () => now, uuid: randomUUID, automationQueueName: "calendar-unit" };
const identity = { organizationId: org, actorId: uid }, caller = { kind: "member" as const, ...identity };
const actor: Actor = { kind: "human", userId: uid, memberId: mid, organizationId: org, role: "owner", name: "Owner", email: `${uid}@local.test` };
let calendarId: string, personId: string, secondWorkspace: string;
const key = randomUUID;
const call = <K extends CalendarCommand>(command: K, input: CalendarCommands[K]) => executeCalendar(deps, caller, command, input);
const range = { rangeStart: "2030-03-09T00:00:00Z", rangeEnd: "2030-03-12T00:00:00Z" };
const reminder = { kind: "before_start" as const, offsetMinutes: 30, agentUserId: aid, prompt: "Check {{event.booking.title}}", maxLatenessMinutes: 60 };
const grants = () => [{ calendarId, canRead: true, canReadAvailability: false, canCreate: true, canUpdate: true, canCancel: true, canManage: false, canTriggerAgent: true }];
const app = new Hono().route("/api", createSiteApiRoutes(async () => ({ commands: deps, identity: { database: resource.db, resolveSession: async () => null }, siteRateLimit: async () => {}, close: async () => {} })))
  .route("/api/commands", createCommandsRoute(async () => ({ commands: deps, identity: { database: resource.db, resolveSession: async () => ({ user: { id: uid, name: actor.name, email: actor.email }, session: { activeOrganizationId: org } }) }, close: async () => {} })));
const sdk = (secret: string) => createClient({ url: "http://fixture.test", key: secret, fetch: async (url, options) => app.request(String(url), options) });
const booking = async (date: string, hour = "10") => call("createBooking", { calendarId, personId, title: "Private customer", time: { start: `${date}T${hour}:00:00Z`, end: `${date}T${hour}:30:00Z`, timeZone: "UTC" }, idempotencyKey: key() });
before(async () => {
  await resource.db.insert(organization).values({ id: org, name: "Calendar triggers", slug: org });
  await resource.db.insert(user).values([{ id: uid, name: actor.name, email: actor.email }, { id: aid, name: "Agent", email: `${aid}@local.test`, kind: "agent" }]);
  await resource.db.insert(member).values([{ id: mid, organizationId: org, userId: uid, role: "owner" }, { id: am, organizationId: org, userId: aid, role: "member" }]);
  await resource.db.insert(agentProfile).values({ id: key(), userId: aid, memberId: am, organizationId: org, displayName: "Agent" });
  const spaces = await resource.db.insert(workspaces).values({ organizationId: org, name: "Other" }).returning(); secondWorkspace = spaces[0].id;
  const [first] = await resource.db.select().from(workspaces).where(and(eq(workspaces.organizationId, org), eq(workspaces.isDefault, true))); deps = { ...deps, workspaceId: first.id };
  calendarId = (await call("createCalendar", { name: "Clinic", timeZone: "UTC", idempotencyKey: key() })).id;
  personId = (await call("createCalendarPerson", { calendarId, name: "Dentist", timeZone: "UTC", idempotencyKey: key() })).id;
  await call("setWorkingHours", { calendarId, personId, expectedVersion: 1, windows: [1,2,3,4,5,6,7].map(day => ({ day, start: "00:00", end: "24:00" })), idempotencyKey: key() });
});
beforeEach(() => { now = new Date("2030-03-08T00:00:00Z"); });
after(async () => { await resource.db.delete(automationEvents).where(eq(automationEvents.organizationId, org)); await resource.db.delete(organization).where(eq(organization.id, org)); await resource.db.delete(user).where(sql`${user.id} in (${uid}, ${aid})`); await other.close(); await resource.close(); });
test("bounded DST projection reads authoritative cron/occurrences, exposes no private conversation and writes no predictions", async () => {
  const rule = await createAutomation(deps, { ...identity, name: "DST", source: { kind: "schedule", cron: "0 9 * * *", timeZone: "America/New_York" }, trigger: { type: "schedule_due" }, actions: [{ type: "run_agent", agentUserId: aid, prompt: "Read" }] });
  const before = await resource.db.select().from(automationOccurrences).where(eq(automationOccurrences.automationId, rule.id));
  const result = await call("queryScheduledOccurrences", { ...range, automationIds: [rule.id] });
  assert.deepEqual(result.items.map(v => v.scheduledFor), ["2030-03-09T14:00:00.000Z", "2030-03-10T13:00:00.000Z", "2030-03-11T13:00:00.000Z"]);
  assert(result.items.every(v => v.projection === "planned" && v.threadId === null));
  assert.deepEqual(await resource.db.select().from(automationOccurrences).where(eq(automationOccurrences.automationId, rule.id)), before);
  await assert.rejects(call("queryScheduledOccurrences", { ...range, automationIds: [rule.id], limit: 1 }), (error: any) => error.code === "QUERY_LIMIT");
  await assert.rejects(executeCalendar({ ...deps, workspaceId: secondWorkspace }, caller, "queryScheduledOccurrences", { ...range, automationIds: [rule.id] }), (error: any) => error.code === "NOT_FOUND");
  await resource.db.update(automationSchedules).set({ nextRunAt: new Date("2030-03-09T14:00:00Z") }).where(eq(automationSchedules.automationId, rule.id));
  now = new Date("2030-03-11T15:00:00Z"); await dispatchDueSchedules(deps, now, 25, org);
  const actual = await call("queryScheduledOccurrences", { ...range, automationIds: [rule.id] });
  assert.equal(actual.items.filter(v => v.projection === "occurred").length, 1); assert(actual.items[0].delayed);
  assert.equal(actual.items.filter(v => v.scheduledFor === "2030-03-10T13:00:00.000Z").length, 0, "missed forecasts are not fabricated execution records");
  now = new Date("2030-03-08T00:00:00Z");
});
test("explicit schedule grants and CAS work through REST/GraphQL/SDK, calendar grants alone cannot read plans", async () => {
  const rule = await createAutomation(deps, { ...identity, name: "Granted", source: { kind: "schedule", cron: "0 10 * * *", timeZone: "UTC" }, trigger: { type: "schedule_due" }, actions: [{ type: "run_agent", agentUserId: aid, prompt: "Private action" }] });
  const saved = await createSiteKey(deps, actor, { name: "Calendar only", permissions: [], calendarPermissions: grants() });
  const client = sdk(saved.secret), input = { ...range, automationIds: [rule.id] };
  await assert.rejects(client.calendar.queryScheduledOccurrences(input), (error: any) => error.code === "FORBIDDEN");
  await updateSiteKey(deps, actor, saved.key.id, { name: "Explicit", permissions: [], calendarPermissions: grants(), schedulePermissions: [{ automationId: rule.id, canRead: true, canUpdate: true }] });
  assert.equal((await client.calendar.queryScheduledOccurrences(input)).items.length, 3);
  const rest = await app.request("http://fixture.test/api/schedules/occurrences/query", { method: "POST", headers: { Authorization: `Bearer ${saved.secret}`, "Content-Type": "application/json" }, body: JSON.stringify(input) }); assert.equal(rest.status, 200);
  assert.equal((await rest.json()).items.length, 3);
  const updated = await client.updateAutomation({ automationId: rule.id, expectedVersion: rule.version, enabled: false }); assert.equal(updated.version, 2);
  await assert.rejects(client.updateAutomation({ automationId: rule.id, expectedVersion: rule.version, enabled: true }), (error: any) => error.code === "VERSION_CONFLICT");
  await assert.rejects(client.updateAutomation({ automationId: rule.id, expectedVersion: 2, actions: [{ type: "run_agent", agentUserId: aid, prompt: "Not authorized by timing grant" }] }), (error: any) => error.code === "FORBIDDEN");
  const races = await Promise.allSettled([updateAutomation(deps, { ...identity, automationId: rule.id, expectedVersion: 2, name: "A" }), updateAutomation({ ...deps, database: other.db }, { ...identity, automationId: rule.id, expectedVersion: 2, name: "B" })]);
  assert.equal(races.filter(v => v.status === "fulfilled").length, 1);
});
test("reminder writes share booking CAS/idempotency, batch rollback and stable revision invalidation", async () => {
  const b = await booking("2030-03-15");
  const input = { calendarId, bookingId: b.id, expectedVersion: 1, reminders: [reminder, { ...reminder, kind: "at_end" as const, offsetMinutes: 0 }], idempotencyKey: key() };
  const receipt = await call("setBookingReminders", input); assert.equal(receipt.revision, 2);
  assert.deepEqual(await call("setBookingReminders", input), receipt);
  const list = await call("listBookingReminders", { calendarId, bookingId: b.id }); assert.equal(list.intents.length, 2); assert.equal(list.reminders.length, 2);
  const moved = await call("rescheduleBooking", { calendarId, bookingId: b.id, expectedVersion: 2, time: { start: "2030-03-15T11:00:00Z", end: "2030-03-15T11:30:00Z", timeZone: "UTC" }, idempotencyKey: key() });
  const history = await call("listBookingReminders", { calendarId, bookingId: b.id }); assert.equal(history.intents.length, 4); assert.equal(history.intents.filter(i => i.status === "superseded").length, 2);
  await resource.db.transaction(async tx => {
    const tools = createCalendarTools(deps, org, uid, tx);
    const result: any = await tools.set_booking_reminders.execute!({ calendarId, bookingId: b.id, expectedVersion: 3, reminders: [{ ...reminder, agentUserId: "absent" }], idempotencyKey: key() }, { toolCallId: key(), messages: [], context: undefined });
    assert.equal(result.error.code, "BAD_INPUT");
  });
  assert.equal((await call("listBookingReminders", { calendarId, bookingId: b.id })).reminders.length, 2, "savepoint restored configuration after native error");
  await assert.rejects(call("batchBookings", { calendarId, operations: [{ kind: "cancel", bookingId: b.id, expectedVersion: 3 }, { kind: "create", personId, title: "Conflict A", time: { start: "2030-03-15T12:00:00Z", end: "2030-03-15T12:30:00Z", timeZone: "UTC" } }, { kind: "create", personId, title: "Conflict B", time: { start: "2030-03-15T12:00:00Z", end: "2030-03-15T12:30:00Z", timeZone: "UTC" } }], idempotencyKey: key() }));
  assert.equal((await call("getBooking", { calendarId, bookingId: b.id })).status, "confirmed");
  assert.equal((await call("listBookingReminders", { calendarId, bookingId: b.id })).intents.filter(v => v.status === "pending").length, 2);
  await call("cancelBooking", { calendarId, bookingId: b.id, expectedVersion: moved.version, idempotencyKey: key() });
  assert((await call("listBookingReminders", { calendarId, bookingId: b.id })).intents.every(v => v.status === "superseded"));
});
test("reminder Key trigger permission is explicit and rechecked at durable acceptance after revocation", async () => {
  const b = await booking("2030-03-16");
  const saved = await createSiteKey(deps, actor, { name: "No agent grant", permissions: [], calendarPermissions: [{ ...grants()[0], canTriggerAgent: false }] });
  const client = sdk(saved.secret);
  const input = { calendarId, bookingId: b.id, expectedVersion: 1, reminders: [reminder], idempotencyKey: key() };
  await assert.rejects(client.calendar.setBookingReminders(input), (error: any) => error.code === "FORBIDDEN");
  await updateSiteKey(deps, actor, saved.key.id, { name: "Granted", permissions: [], calendarPermissions: grants() });
  await client.calendar.setBookingReminders(input);
  assert.equal((await client.calendar.listBookingReminders({ calendarId, bookingId: b.id })).intents.length, 1);
  now = new Date("2030-03-16T09:35:00Z"); await dispatchDueBookingReminders(deps);
  const [intent] = await resource.db.select().from(bookingReminderIntents).where(eq(bookingReminderIntents.bookingId, b.id));
  const [run] = await resource.db.execute(sql`select id from automation_runs where event_id=${intent.eventId}::uuid`);
  await updateSiteKey(deps, actor, saved.key.id, { name: "Revoked", permissions: [], calendarPermissions: [{ ...grants()[0], canTriggerAgent: false }] });
  const rejection = await resource.db.transaction(tx => acceptBookingReminder(deps, tx, run.id as string, uid)); assert.equal(rejection?.status, "failed");
  assert.equal((await resource.db.select().from(bookingReminderIntents).where(eq(bookingReminderIntents.id, intent.id)))[0].acceptedAt, null);
  now = new Date("2030-03-08T00:00:00Z");
});
test("calendar events require an explicit matching workspace and generic rule editing cannot bypass reminder lifecycle", async () => {
  const b = await booking("2030-03-17"); await call("setBookingReminders", { calendarId, bookingId: b.id, expectedVersion: 1, reminders: [reminder], idempotencyKey: key() });
  const [config] = await resource.db.select().from(bookingReminders).where(eq(bookingReminders.bookingId, b.id));
  const [raw] = await resource.db.select().from(automations).where(eq(automations.id, config.automationId));
  const rule = raw as unknown as AutomationRule;
  const event = { id: key(), organizationId: org, source: rule.source, type: "booking_reminder_due" as const, occurredAt: now.toISOString(), data: {}, traceId: key() };
  await assert.rejects(resource.db.transaction(tx => appendExternalAutomationEvent(deps, tx, event, [rule])), /explicit workspace/);
  assert.equal(await resource.db.transaction(tx => appendExternalAutomationEvent(deps, tx, { ...event, workspaceId: secondWorkspace }, [rule])), null);
  await assert.rejects(updateAutomation(deps, { ...identity, automationId: rule.id, enabled: false }), (error: any) => error.code === "BAD_INPUT");
});

test("actual native and MCP operations configure/query reminders and read/update the original plan with CAS", { timeout: 30000 }, async () => {
  const b = await booking("2030-03-18");
  const rule = await createAutomation(deps, { ...identity, name: "MCP plan", source: { kind: "schedule", cron: "0 10 * * *", timeZone: "UTC" }, trigger: { type: "schedule_due" }, actions: [{ type: "run_agent", agentUserId: aid, prompt: "Read" }] });
  const tools = createTableTools(deps, undefined, org, uid);
  const invoke = (name: string, input: unknown) => tools[name].execute(input, { toolCallId: key(), messages: [], context: undefined });
  const configured = await invoke("set_booking_reminders", { calendarId, bookingId: b.id, expectedVersion: 1, reminders: [reminder], idempotencyKey: key() }); assert.equal(configured.version, 2);
  assert.equal((await invoke("list_booking_reminders", { calendarId, bookingId: b.id })).intents.length, 1);
  assert.equal((await invoke("query_scheduled_occurrences", { ...range, automationIds: [rule.id] })).items.length, 3);
  const updated = await invoke("update_automation", { automationId: rule.id, expectedVersion: 1, name: "Native plan" }); assert.equal(updated.version, 2);
  const saved = await createSiteKey(deps, actor, { name: "MCP reminder", permissions: [], calendarPermissions: grants(), schedulePermissions: [{ automationId: rule.id, canRead: true, canUpdate: true }] });
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }); if (!server.listening) await new Promise(resolve => server.once("listening", resolve)); const address = server.address(); assert(address && typeof address !== "string");
  try {
    const calls = [
      { name: "query_scheduled_occurrences", input: { ...range, automationIds: [rule.id] }, expect: { "items.length": 3 } },
      { name: "set_booking_reminders", input: { calendarId, bookingId: b.id, expectedVersion: 2, reminders: [reminder, { ...reminder, kind: "at_end", offsetMinutes: 0 }], idempotencyKey: key() }, expect: { version: 3 } },
      { name: "list_booking_reminders", input: { calendarId, bookingId: b.id }, expect: { "reminders.length": 2, "intents.length": 3 } },
      { name: "update_automation", input: { automationId: rule.id, expectedVersion: 2, enabled: false }, expect: { version: 3, enabled: false } },
    ];
    const output = await promisify(execFile)(process.execPath, [fileURLToPath(new URL("../../../mcp/test/calendar-client.mjs", import.meta.url))], { env: { ...process.env, TABDO_API_URL: `http://127.0.0.1:${address.port}`, TABDO_API_KEY: saved.secret, CALENDAR_MCP_TSX: createRequire(import.meta.url).resolve("tsx/cli"), CALENDAR_MCP_CASE: JSON.stringify({ calls }) } });
    assert.equal(JSON.parse(output.stdout).mcp, "PASS");
  } finally { if ("closeAllConnections" in server) server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("thin REST reminder configuration enforces explicit trigger/read grants, CAS and revoked replay", async () => {
  const b = await booking("2030-03-25");
  const path = `/api/calendars/${calendarId}/bookings/${b.id}/reminders`;
  const createKey = (canRead: boolean, canTriggerAgent: boolean) => createSiteKey(deps, actor, { name: "REST reminder", permissions: [],
    calendarPermissions: grants().map(grant => ({ ...grant, canRead, canTriggerAgent })) });
  const denied = await createKey(true, false), allowed = await createKey(true, true), writeOnly = await createKey(false, true);
  const request = (secret: string, version: number, reminders: unknown = [reminder], idempotencyKey = key()) => app.request(path, {
    method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ expectedVersion: version, reminders }),
  });
  const forbidden = await request(denied.secret, 1); assert.equal(forbidden.status, 403); assert.equal((await forbidden.json()).code, "FORBIDDEN");
  const malformed = await request(allowed.secret, 1, [{ ...reminder, offsetMinutes: 0 }]); assert.equal(malformed.status, 400);
  const receiptKey = key(); const saved = await request(allowed.secret, 1, [reminder], receiptKey); assert.equal(saved.status, 200); assert.equal((await saved.json()).version, 2);
  const read = await app.request(path, { headers: { Authorization: `Bearer ${allowed.secret}` } }); assert.equal(read.status, 200); assert.equal((await read.json()).reminders.length, 1);
  assert.equal((await app.request(path, { headers: { Authorization: `Bearer ${writeOnly.secret}` } })).status, 403);
  const stale = await request(allowed.secret, 1, []); assert.equal(stale.status, 409); assert.equal((await stale.json()).code, "VERSION_CONFLICT");
  const replay = await request(allowed.secret, 1, [reminder], receiptKey); assert.equal(replay.status, 200); assert.equal((await replay.json()).version, 2);
  await updateSiteKey(deps, actor, allowed.key.id, { name: "Revoked trigger", permissions: [], calendarPermissions: grants().map(grant => ({ ...grant, canTriggerAgent: false })) });
  assert.equal((await request(allowed.secret, 1, [reminder], receiptKey)).status, 403);
  const revoked = await request(writeOnly.secret, 2, []); assert.equal(revoked.status, 200); assert.equal((await revoked.json()).version, 3);
});
