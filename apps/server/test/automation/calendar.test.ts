import { createMcpRoute } from "../../src/mcp/route.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
import { organization, user, member, agentProfile, workspaces, tables, rows, bookings, bookingReminderIntents, bookingReminders, automations, automationOccurrences, automationSchedules, automationEvents, automationRuns, automationAgentActions, chatThreads } from "../../src/business/db/schema.js";
import type { CommandDependencies } from "../../src/business/dependencies.js";
import { executeCalendar } from "../../src/business/calendar/service.js";
import { createAutomation, updateAutomation, listAutomationRuns } from "../../src/business/automation/crud.js";
import { readableRunDetails } from "../../src/business/automation/run-visibility.js";
import { dispatchDueSchedules } from "../../src/business/automation/schedule.js";
import { appendExternalAutomationEvent } from "../../src/business/automation/events.js";
import { createSiteKey, updateSiteKey } from "../../src/business/data-api/keys.js";
import { createSiteApiRoutes, createSiteKeysRoute } from "../../src/business/http/site-api.js";
import { createCommandsRoute } from "../../src/business/http/commands.js";
import { createCalendarTools } from "../../src/business/agent/tools/calendar.js";
import { acceptBookingReminder, dispatchDueBookingReminders, readBookingReminders } from "../../src/business/calendar/reminders.js";
import type { Actor } from "../../src/business/auth/actor.js";
import { EMPTY_DOCUMENT, type ApiKeyInput, type CalendarCommand, type CalendarCommands, type AutomationRule } from "@tabdo/shared";
const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test")); assert.equal(process.env.DATABASE_URL_UNPOOLED, url);
const resource = createDatabase({ connectionString: url, poolMax: 8 });
const other = createDatabase({ connectionString: url, poolMax: 2 });
const org = randomUUID(), uid = randomUUID(), mid = randomUUID(), aid = randomUUID(), am = randomUUID(), peerId = randomUUID(), adminId = randomUUID();
let now = new Date("2030-03-08T00:00:00Z");
let deps: CommandDependencies = { database: resource.db, now: () => now, uuid: randomUUID, automationQueueName: "calendar-unit" };
const identity = { organizationId: org, actorId: uid }, caller = { kind: "member" as const, ...identity };
const actor: Actor = { kind: "human", userId: uid, memberId: mid, organizationId: org, role: "owner", name: "Owner", email: `${uid}@local.test` };
let calendarId: string, personId: string, secondWorkspace: string;
const key = randomUUID;
const call = <K extends CalendarCommand>(command: K, input: CalendarCommands[K]) => executeCalendar(deps, caller, command, input);
const range = { rangeStart: "2030-03-09T00:00:00Z", rangeEnd: "2030-03-12T00:00:00Z" };
const reminder = { kind: "before_start" as const, offsetMinutes: 30, agentUserId: aid, prompt: "Check {{event.booking.title}}", maxLatenessMinutes: 60 };
const grants = () => [{ calendarId, canRead: true, canReadAvailability: false, canCreate: true, canUpdate: true, canCancel: true, canManage: false, canTriggerAgent: true, canSubscribe: false, canReadDeliveries: false, canManageSubscriptions: false }];
const app = new Hono().route("/mcp", createMcpRoute(async () => ({ commands: deps, identity: { database: resource.db, resolveSession: async () => null }, siteRateLimit: async () => {}, close: async () => {} }), { publicOrigin: "http://fixture.test", allowedOrigins: [] })).route("/api", createSiteApiRoutes(async () => ({ commands: deps, identity: { database: resource.db, resolveSession: async () => null }, siteRateLimit: async () => {}, close: async () => {} })))
  .route("/api/commands", createCommandsRoute(async () => ({ commands: deps, identity: { database: resource.db, resolveSession: async () => ({ user: { id: uid, name: actor.name, email: actor.email }, session: { activeOrganizationId: org } }) }, close: async () => {} })));
const sdk = (secret: string) => createClient({ url: "http://fixture.test", key: secret, fetch: async (url, options) => app.request(String(url), options) });
const booking = async (date: string, hour = "10") => call("createBooking", { calendarId, personId, title: "Private customer", time: { start: `${date}T${hour}:00:00Z`, end: `${date}T${hour}:30:00Z`, timeZone: "UTC" }, idempotencyKey: key() });
before(async () => {
  await resource.db.insert(organization).values({ id: org, name: "Calendar triggers", slug: org });
  await resource.db.insert(user).values([{ id: uid, name: actor.name, email: actor.email }, { id: aid, name: "Agent", email: `${aid}@local.test`, kind: "agent" }, { id: peerId, name: "Other member", email: `${peerId}@local.test` }, { id: adminId, name: "Admin", email: `${adminId}@local.test` }]);
  await resource.db.insert(member).values([{ id: mid, organizationId: org, userId: uid, role: "owner" }, { id: am, organizationId: org, userId: aid, role: "member" }, { id: key(), organizationId: org, userId: peerId, role: "member" }, { id: key(), organizationId: org, userId: adminId, role: "admin" }]);
  await resource.db.insert(agentProfile).values({ id: key(), userId: aid, memberId: am, organizationId: org, displayName: "Agent" });
  const spaces = await resource.db.insert(workspaces).values({ organizationId: org, name: "Other" }).returning(); secondWorkspace = spaces[0].id;
  const [first] = await resource.db.select().from(workspaces).where(and(eq(workspaces.organizationId, org), eq(workspaces.isDefault, true))); deps = { ...deps, workspaceId: first.id };
  calendarId = (await call("createCalendar", { name: "Clinic", timeZone: "UTC", idempotencyKey: key() })).id;
  personId = (await call("createCalendarPerson", { calendarId, name: "Dentist", timeZone: "UTC", idempotencyKey: key() })).id;
  await call("setWorkingHours", { calendarId, personId, expectedVersion: 1, windows: [1,2,3,4,5,6,7].map(day => ({ day, start: "00:00", end: "24:00" })), idempotencyKey: key() });
});
beforeEach(() => { now = new Date("2030-03-08T00:00:00Z"); });
after(async () => { await resource.db.delete(automationEvents).where(eq(automationEvents.organizationId, org)); await resource.db.delete(organization).where(eq(organization.id, org)); await resource.db.delete(user).where(sql`${user.id} in (${uid}, ${aid}, ${peerId}, ${adminId})`); await other.close(); await resource.close(); });
test("one Key preserves independent table, calendar, schedule, document and blog grants across HTTP edits and shared SDK/native execution", async () => {
  const [table] = await resource.db.insert(tables).values({ organizationId: org, workspaceId: deps.workspaceId!, name: "Combined capabilities" }).returning();
  const [row] = await resource.db.insert(rows).values({ tableId: table.id }).returning();
  const rule = await createAutomation(deps, { ...identity, name: "Combined plan", source: { kind: "schedule", cron: "0 10 * * *", timeZone: "UTC" }, trigger: { type: "schedule_due" }, actions: [{ type: "run_agent", agentUserId: aid, prompt: "Private" }] });
  const management = createSiteKeysRoute(async () => ({ commands: deps, identity: { database: resource.db, resolveSession: async () => ({ user: { id: uid, name: actor.name, email: actor.email }, session: { activeOrganizationId: org } }) }, close: async () => {} }));
  let input: ApiKeyInput = { name: "All five", blogPermissions: [{ tableId: table.id, canRead: true, canConfigure: false, canBuild: false, canPublish: false, canRestore: false }], permissions: [{ tableId: table.id, canRead: true, canCreate: false, canUpdate: false, canDelete: false }], calendarPermissions: grants(), schedulePermissions: [{ automationId: rule.id, canRead: true, canUpdate: true }], documentPermissions: [{ tableId: table.id, canRead: true, canCreate: true, canUpdate: false, canReadHistory: false, canRestore: false, canUpload: false }] };
  const response = await management.request("/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  assert.equal(response.status, 201);
  const saved = await response.json(), client = sdk(saved.secret), location = { tableId: table.id, rowId: row.id };
  await client.documents.createDocument({ ...location, content: EMPTY_DOCUMENT, idempotencyKey: key() });
  assert.deepEqual((await client.documents.getDocument(location))!.content, EMPTY_DOCUMENT);
  assert.equal((await client.blogs.getBlogSources({ tableId: table.id })).items[0].rowId, row.id);
  assert.equal((await client.calendar.getCalendar({ calendarId })).id, calendarId);
  assert((await client.calendar.queryScheduledOccurrences({ ...range, automationIds: [rule.id] })).items.length);
  assert.equal((await client.table(table.id).get(row.id))!.id, row.id);
  const restDocument = await app.request("/api/commands", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${saved.secret}` }, body: JSON.stringify({ command: "getDocument", input: location }) });
  assert.equal(restDocument.status, 200); assert.deepEqual((await restDocument.json()).result.content, EMPTY_DOCUMENT);
  const mixedMutation = await app.request("/api/graphql", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${saved.secret}` }, body: JSON.stringify({ query: "mutation($doc:JSON!,$plan:JSON!){createDocument(input:$doc) updateAutomation(input:$plan)}", variables: { doc: { ...location, content: EMPTY_DOCUMENT, idempotencyKey: key() }, plan: { automationId: rule.id, name: "Must not update", expectedVersion: rule.version } } }) });
  assert.equal((await mixedMutation.json()).errors[0].extensions.code, "QUERY_TOO_COMPLEX");
  const tools = createTableTools(deps, table.id, org, uid);
  assert.deepEqual((await tools.get_document.execute(location, { toolCallId: key(), messages: [] })).content, EMPTY_DOCUMENT);
  assert.equal((await tools.get_calendar.execute({ calendarId }, { toolCallId: key(), messages: [] })).id, calendarId);
  assert((await tools.query_scheduled_occurrences.execute({ ...range, automationIds: [rule.id] }, { toolCallId: key(), messages: [] })).items.length);
  // The three outbound capabilities remain independent of agent triggering and all five families.
  for (const capability of ["canSubscribe", "canReadDeliveries", "canManageSubscriptions"] as const) {
    input = { ...input, calendarPermissions: [{ ...input.calendarPermissions![0], [capability]: true }] };
    const edited = await management.request(`/${saved.key.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    assert.equal(edited.status, 200);
    const listed = (await (await management.request("/")).json()).keys.find((value: { id: string }) => value.id === saved.key.id);
    for (const family of ["permissions", "documentPermissions", "schedulePermissions", "calendarPermissions", "blogPermissions"] as const) assert.deepEqual(listed[family], input[family]);
  }
  // Each edit changes one family and sends back every other family unchanged.
  for (const change of [
    { blogPermissions: [{ ...input.blogPermissions![0], canBuild: true }] },
    { documentPermissions: [{ ...input.documentPermissions![0], canReadHistory: true }] },
    { schedulePermissions: [{ ...input.schedulePermissions![0], canUpdate: false }] },
    { calendarPermissions: [{ ...input.calendarPermissions![0], canTriggerAgent: false }] },
    { permissions: [{ ...input.permissions[0], canCreate: true }] },
  ]) {
    input = { ...input, ...change };
    const edited = await management.request(`/${saved.key.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    assert.equal(edited.status, 200);
    const listed = (await (await management.request("/")).json()).keys.find((value: { id: string }) => value.id === saved.key.id);
    for (const family of ["permissions", "documentPermissions", "schedulePermissions", "calendarPermissions", "blogPermissions"] as const) assert.deepEqual(listed[family], input[family]);
  }
  const rejectedEdit = await management.request(`/${saved.key.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, permissions: [], documentPermissions: [{ ...input.documentPermissions![0], tableId: key() }] }) });
  assert.equal(rejectedEdit.status, 400);
  const unchanged = (await (await management.request("/")).json()).keys.find((value: { id: string }) => value.id === saved.key.id);
  for (const family of ["permissions", "documentPermissions", "schedulePermissions", "calendarPermissions", "blogPermissions"] as const) assert.deepEqual(unchanged[family], input[family], "An invalid grant rolls back the entire edit");
  await assert.rejects(client.updateAutomation({ automationId: rule.id, name: "Denied", expectedVersion: rule.version }), (error: any) => error.code === "FORBIDDEN");
  // A document-only Key cannot read table records, calendars, or schedules.
  const isolated = await createSiteKey(deps, actor, { name: "Document only", permissions: [], documentPermissions: input.documentPermissions });
  const documentOnly = sdk(isolated.secret);
  assert.equal((await documentOnly.documents.getDocument(location))!.version, 1);
  await assert.rejects(documentOnly.blogs.getBlogSources({ tableId: table.id }));
  await assert.rejects(documentOnly.table(table.id).get(row.id));
  await assert.rejects(documentOnly.calendar.getCalendar({ calendarId }));
  await assert.rejects(documentOnly.calendar.queryScheduledOccurrences({ ...range, automationIds: [rule.id] }));
});
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
    const output = await promisify(execFile)(process.execPath, [fileURLToPath(new URL("../fixtures/mcp/calendar-client.mjs", import.meta.url))], { env: { ...process.env, MCP_TEST_URL: `http://127.0.0.1:${address.port}/mcp`, MCP_TEST_KEY: saved.secret, CALENDAR_MCP_CASE: JSON.stringify({ calls }) } });
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
test("reminder reason cannot bypass private run diagnostics for another member or a calendar-read Key", async () => {
  const b = await booking("2030-03-27");
  await call("setBookingReminders", { calendarId, bookingId: b.id, expectedVersion: 1, reminders: [reminder], idempotencyKey: key() });
  now = new Date("2030-03-27T09:35:00Z"); await dispatchDueBookingReminders(deps);
  const [intent] = await resource.db.select().from(bookingReminderIntents).where(eq(bookingReminderIntents.bookingId, b.id)); assert(intent.eventId);
  const [run] = await resource.db.select().from(automationRuns).where(eq(automationRuns.eventId, intent.eventId));
  const threadId = key(), diagnostic = `PRIVATE_RUN_DIAGNOSTIC:${key()}`;
  // A valid persisted failure after private-thread association, before native acceptance.
  await resource.db.insert(chatThreads).values({ id: threadId, userId: uid, organizationId: org, workspaceId: deps.workspaceId!, clientId: key(), kind: "chat" });
  await resource.db.insert(automationAgentActions).values({ runId: run.id, step: 0, threadId, userMessageId: key() });
  await resource.db.update(automationRuns).set({ status: "failed", error: diagnostic, finishedAt: now, detail: { threadId } }).where(eq(automationRuns.id, run.id));
  const shared = await listAutomationRuns(deps, { organizationId: org, actorId: peerId, automationId: run.automationId });
  assert.equal(shared[0].error, null, "the repaired generic history correctly hides this private diagnostic");
  assert.equal((await call("listBookingReminders", { calendarId, bookingId: b.id })).intents[0].reason, diagnostic, "owner retains the real failure");
  const peer = await executeCalendar(deps, { kind: "member", organizationId: org, actorId: peerId }, "listBookingReminders", { calendarId, bookingId: b.id });
  assert.equal(peer.intents[0].threadId, null);
  const saved = await createSiteKey(deps, actor, { name: "Read reminder state", permissions: [], calendarPermissions: grants().map(grant => ({ ...grant, canCreate: false, canUpdate: false, canCancel: false, canTriggerAgent: false })) });
  const response = await app.request(`/api/calendars/${calendarId}/bookings/${b.id}/reminders`, { headers: { Authorization: `Bearer ${saved.secret}` } });
  assert.equal(response.status, 200); const publicHistory = await response.json();
  const leaks = { member: JSON.stringify(peer).includes(diagnostic), keyRest: JSON.stringify(publicHistory).includes(diagnostic) };
  console.log("CALENDAR_PRIVATE_ERROR_REASON", JSON.stringify({ genericError: shared[0].error, leaks, peer, keyRest: publicHistory }));
  assert.deepEqual(leaks, { member: false, keyRest: false }, "Reminder reason must respect the same private-run visibility boundary");
});

async function privateReminderFailure(date: string) {
  const b = await booking(date);
  await call("setBookingReminders", { calendarId, bookingId: b.id, expectedVersion: 1, reminders: [reminder], idempotencyKey: key() });
  now = new Date(`${date}T09:35:00Z`); await dispatchDueBookingReminders(deps);
  const [intent] = await resource.db.select().from(bookingReminderIntents).where(eq(bookingReminderIntents.bookingId, b.id)); assert(intent.eventId);
  const [run] = await resource.db.select().from(automationRuns).where(eq(automationRuns.eventId, intent.eventId));
  const threadId = key(), diagnostic = `PRIVATE_DIAGNOSTIC:${key()}`;
  await resource.db.insert(chatThreads).values({ id: threadId, userId: uid, organizationId: org, workspaceId: deps.workspaceId!, clientId: key() });
  await resource.db.insert(automationAgentActions).values({ runId: run.id, step: 0, threadId, userMessageId: key() });
  await resource.db.update(automationRuns).set({ status: "failed", error: diagnostic, finishedAt: now, detail: { threadId } }).where(eq(automationRuns.id, run.id));
  const [stored] = await resource.db.select().from(bookings).where(eq(bookings.id, b.id));
  const input = { calendarId, bookingId: b.id };
  const read = (actorId = uid) => executeCalendar(deps, { kind: "member", organizationId: org, actorId }, "listBookingReminders", input);
  const noViewer = () => resource.db.transaction(tx => readBookingReminders(deps, tx, stored, org));
  return { b, intent, run, threadId, diagnostic, input, read, noViewer };
}
const readOnlyReminderKey = () => createSiteKey(deps, actor, { name: "Read reminder states", permissions: [],
  calendarPermissions: grants().map(grant => ({ ...grant, canCreate: false, canUpdate: false, canCancel: false, canTriggerAgent: false })) });
const assertAbsent = (value: unknown, secrets: string[]) => {
  const serialized = JSON.stringify(value);
  for (const secret of secrets) assert(!serialized.includes(secret), "Serialized reminder response leaked a private value");
};

test("reminder diagnostics preserve safe intent codes and priority while guarding accepted and pre-acceptance failures", async () => {
  const f = await privateReminderFailure("2030-04-01"), saved = await readOnlyReminderKey();
  const privateIntent = `PRIVATE_INTENT:${key()}`;
  const cases = [
    { intentReason: null, runError: f.diagnostic, ownerReason: f.diagnostic, publicReason: null },
    { intentReason: privateIntent, runError: f.diagnostic, ownerReason: privateIntent, publicReason: null },
    { intentReason: privateIntent, runError: null, ownerReason: privateIntent, publicReason: null },
    { intentReason: "", runError: f.diagnostic, ownerReason: "", publicReason: null },
    // Only intent.reason is a source of public lifecycle codes; run.error is free text.
    { intentReason: null, runError: "deadline_expired", ownerReason: "deadline_expired", publicReason: null },
    ...["deadline_expired", "booking_revision_changed", "reminder_authorization_revoked", "invalid_reminder_scope", "deadline_not_due"].map(code => ({ intentReason: code, runError: f.diagnostic, ownerReason: code, publicReason: code })),
  ];
  for (const accepted of [false, true]) for (const item of cases) {
    await resource.db.update(bookingReminderIntents).set({ acceptedAt: accepted ? now : null, status: "failed", reason: item.intentReason }).where(eq(bookingReminderIntents.id, f.intent.id));
    await resource.db.update(automationRuns).set({ error: item.runError }).where(eq(automationRuns.id, f.run.id));
    const owned = await f.read(); assert.equal(owned.intents[0].reason, item.ownerReason);
    assert.equal(owned.intents[0].threadId, accepted ? f.threadId : null);
    const response = await app.request(`/api/calendars/${calendarId}/bookings/${f.b.id}/reminders`, { headers: { Authorization: `Bearer ${saved.secret}` } }); assert.equal(response.status, 200);
    for (const history of [await f.read(peerId), await f.read(adminId), await f.noViewer(), await response.json()]) {
      assert.equal(history.intents.length, 1); assert.equal(history.intents[0].reason, item.publicReason);
      assert.equal(history.intents[0].status, "failed"); assertAbsent(history, [f.threadId, f.diagnostic, privateIntent]);
    }
  }
  await resource.db.update(automations).set({ createdByUserId: peerId }).where(eq(automations.id, f.run.automationId));
  await resource.db.update(bookingReminderIntents).set({ reason: null }).where(eq(bookingReminderIntents.id, f.intent.id));
  await resource.db.update(automationRuns).set({ error: f.diagnostic, status: f.diagnostic }).where(eq(automationRuns.id, f.run.id));
  assert.equal((await f.read()).intents[0].reason, f.diagnostic, "history follows the actual thread owner");
  const peer = await f.read(peerId); assert.equal(peer.intents[0].status, "unknown"); assertAbsent(peer, [f.diagnostic, f.threadId]);
});

test("missing, foreign, mixed and unresolved reminder threads never authorize diagnostics or accepted links", async () => {
  const f = await privateReminderFailure("2030-04-02");
  await resource.db.update(bookingReminderIntents).set({ acceptedAt: now }).where(eq(bookingReminderIntents.id, f.intent.id));
  const deny = async () => {
    for (const history of [await f.read(), await f.read(peerId), await f.read(adminId), await f.noViewer()]) {
      assert.equal(history.intents.length, 1); assert.equal(history.intents[0].reason, null);
      assert.equal(history.intents[0].threadId, null); assert.equal(history.intents[0].runId, null); assertAbsent(history, [f.diagnostic, f.threadId]);
    }
  };
  const second = key();
  await resource.db.insert(chatThreads).values({ id: second, userId: peerId, organizationId: org, workspaceId: deps.workspaceId!, clientId: key() });
  await resource.db.insert(automationAgentActions).values({ runId: f.run.id, step: 1, threadId: second, userMessageId: key() });
  await deny();
  await resource.db.delete(automationAgentActions).where(and(eq(automationAgentActions.runId, f.run.id), eq(automationAgentActions.step, 1)));
  await resource.db.update(automationAgentActions).set({ agentRunId: key() }).where(eq(automationAgentActions.runId, f.run.id));
  await deny();
  await resource.db.update(automationAgentActions).set({ agentRunId: null }).where(eq(automationAgentActions.runId, f.run.id));
  const foreignWorkspaceThread = key();
  await resource.db.insert(chatThreads).values({ id: foreignWorkspaceThread, userId: uid, organizationId: org, workspaceId: secondWorkspace, clientId: key() });
  await resource.db.update(automationAgentActions).set({ threadId: foreignWorkspaceThread }).where(eq(automationAgentActions.runId, f.run.id));
  await resource.db.update(automationRuns).set({ detail: { threadId: foreignWorkspaceThread } }).where(eq(automationRuns.id, f.run.id)); await deny();
  const otherOrg = key();
  await resource.db.insert(organization).values({ id: otherOrg, name: "Foreign", slug: otherOrg });
  try {
    const [space] = await resource.db.select().from(workspaces).where(and(eq(workspaces.organizationId, otherOrg), eq(workspaces.isDefault, true)));
    const foreignOrgThread = key();
    await resource.db.insert(chatThreads).values({ id: foreignOrgThread, userId: uid, organizationId: otherOrg, workspaceId: space.id, clientId: key() });
    await resource.db.update(automationAgentActions).set({ threadId: foreignOrgThread }).where(eq(automationAgentActions.runId, f.run.id));
    await resource.db.update(automationRuns).set({ detail: { threadId: foreignOrgThread } }).where(eq(automationRuns.id, f.run.id)); await deny();
  } finally { await resource.db.delete(organization).where(eq(organization.id, otherOrg)); }
  await deny(); // The persistent mapping now references a deleted thread.
  await resource.db.delete(automationAgentActions).where(eq(automationAgentActions.runId, f.run.id));
  await resource.db.update(automationRuns).set({ ruleSnapshot: { actions: [] }, detail: {} }).where(eq(automationRuns.id, f.run.id));
  await deny(); // Managed reminder diagnostics are private even without a usable snapshot/mapping.
  await resource.db.delete(automationRuns).where(eq(automationRuns.id, f.run.id));
  await resource.db.update(bookingReminderIntents).set({ reason: f.diagnostic }).where(eq(bookingReminderIntents.id, f.intent.id)); await deny();
  await resource.db.update(bookingReminderIntents).set({ reason: "deadline_expired" }).where(eq(bookingReminderIntents.id, f.intent.id));
  assert.equal((await f.read(peerId)).intents[0].reason, "deadline_expired", "known lifecycle state survives loss of the private run");
});

test("native, member command, SDK GraphQL and actual MCP reminder reads share diagnostic visibility", { timeout: 30000 }, async () => {
  const f = await privateReminderFailure("2030-04-03"), saved = await readOnlyReminderKey();
  for (const actorId of [uid, peerId, adminId]) {
    const native = await createTableTools(deps, undefined, org, actorId).list_booking_reminders.execute(f.input, { toolCallId: key(), messages: [], context: undefined });
    if (actorId === uid) assert(JSON.stringify(native).includes(f.diagnostic)); else assertAbsent(native, [f.diagnostic, f.threadId]);
    const memberApp = new Hono().route("/api/commands", createCommandsRoute(async () => ({ commands: deps, identity: { database: resource.db,
      resolveSession: async () => ({ user: { id: actorId, name: actorId, email: `${actorId}@local.test` }, session: { activeOrganizationId: org } }) }, close: async () => {} })));
    const response = await memberApp.request("/api/commands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: "listBookingReminders", input: f.input }) });
    assert.equal(response.status, 200); const body = await response.json();
    if (actorId === uid) assert(JSON.stringify(body).includes(f.diagnostic)); else assertAbsent(body, [f.diagnostic, f.threadId]);
  }
  assertAbsent(await sdk(saved.secret).calendar.listBookingReminders(f.input), [f.diagnostic, f.threadId]);
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  if (!server.listening) await new Promise(resolve => server.once("listening", resolve)); const address = server.address(); assert(address && typeof address !== "string");
  try {
    const output: { stdout: string; stderr: string } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL("../fixtures/mcp/calendar-client.mjs", import.meta.url))], { env: {
      ...process.env, MCP_TEST_URL: `http://127.0.0.1:${address.port}/mcp`, MCP_TEST_KEY: saved.secret, MCP_TEST_WORKSPACE: deps.workspaceId!,
      CALENDAR_MCP_CASE: JSON.stringify({ calls: [{ name: "list_booking_reminders", input: f.input, absent: [f.diagnostic, f.threadId] }] }),
    } });
    assert.equal(JSON.parse(output.stdout).mcp, "PASS");
  } finally { if ("closeAllConnections" in server) server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("managed reminder history with incomplete action metadata stays private across reminder and generic reads", async () => {
  const f = await privateReminderFailure("2030-04-04");
  await resource.db.delete(automationAgentActions).where(eq(automationAgentActions.runId, f.run.id));
  // Match the incomplete historical metadata state covered by the reminder DTO test,
  // while preserving the saved calendar source and the authoritative managed rule.
  await resource.db.update(automationRuns).set({ ruleSnapshot: { ...f.run.ruleSnapshot, actions: [] }, detail: {} }).where(eq(automationRuns.id, f.run.id));
  const reminder = await f.read(peerId);
  assertAbsent(reminder, [f.diagnostic]);
  const generic = await listAutomationRuns(deps, { organizationId: org, actorId: peerId, automationId: f.run.automationId });
  const native = await createTableTools(deps, undefined, org, peerId).list_automation_runs.execute({ automationId: f.run.automationId }, { toolCallId: key(), messages: [], context: undefined });
  const leaks = { reminder: JSON.stringify(reminder).includes(f.diagnostic), generic: JSON.stringify(generic).includes(f.diagnostic), native: JSON.stringify(native).includes(f.diagnostic) };
  console.log("CALENDAR_INCOMPLETE_PRIVATE_HISTORY", JSON.stringify({ leaks, reminder, generic, native }));
  assert.deepEqual(leaks, { reminder: false, generic: false, native: false }, "Known managed agent reminders must not become public data results when historical action metadata is incomplete");
  const [incomplete] = await resource.db.select().from(automationRuns).where(eq(automationRuns.id, f.run.id));
  assert(!(await readableRunDetails(deps, [{ run: incomplete, actions: [], source: null }], org, peerId)).has(f.run.id), "saved managed source alone retains private classification");
  for (const snapshot of [null, { actions: [] }, { ...f.run.ruleSnapshot, actions: undefined }]) {
    await resource.db.update(automationRuns).set({ ruleSnapshot: snapshot }).where(eq(automationRuns.id, f.run.id));
    for (const actorId of [uid, peerId, adminId, undefined]) {
      const history = await listAutomationRuns(deps, { organizationId: org, actorId, automationId: f.run.automationId });
      assert.equal(history.length, 1); assert.equal(history[0].status, "failed"); assertAbsent(history, [f.diagnostic]);
    }
    assertAbsent(await f.read(peerId), [f.diagnostic]);
  }
  await resource.db.insert(automationAgentActions).values({ runId: f.run.id, step: 0, threadId: f.threadId, userMessageId: key() });
  assert.equal((await listAutomationRuns(deps, { organizationId: org, actorId: uid, automationId: f.run.automationId }))[0].error, f.diagnostic);
  assert.equal((await f.read()).intents[0].reason, f.diagnostic, "verified owner still sees the result when action metadata is incomplete");
});
