import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDatabase } from "../../src/business/db/factory.js";
import { organization, user, member } from "../../src/business/db/schema.js";
import type { CommandDependencies } from "../../src/business/dependencies.js";
import { createSiteApiRoutes } from "../../src/business/http/site-api.js";
import { createCommandsRoute } from "../../src/business/http/commands.js";
import { createSiteKey, updateSiteKey } from "../../src/business/data-api/keys.js";
import { executeCalendar } from "../../src/business/calendar/service.js";
import { dispatchCommand } from "../../src/business/services/command-dispatch.js";
import { createCalendarTools } from "../../src/business/agent/tools/calendar.js";
import { getAgentToolCatalog } from "../../src/harness/tool-catalog.js";
import type { Actor } from "../../src/business/auth/actor.js";
import type { RequestScopeResolver } from "../../src/business/http/request.js";
import { CALENDAR_TOOLS, CALENDAR_COMMANDS, CALENDAR_SCHEMAS, DISABLED_TOOLS_SCHEMA, type CalendarCommand, type CalendarCommands, type WorkingWindow } from "@tabdo/shared";
import { createClient } from "@tabdo/sdk";

const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test")); assert.equal(process.env.DATABASE_URL_UNPOOLED, url);
const resource = createDatabase({ connectionString: url, poolMax: 5 });
const org = randomUUID(), uid = randomUUID(), mid = randomUUID();
const deps: CommandDependencies = { database: resource.db, now: () => new Date("2029-01-01T00:00:00Z"), uuid: randomUUID, automationQueueName: "unused" };
const actor: Actor = { organizationId: org, userId: uid, memberId: mid, kind: "human", role: "owner", name: "API calendar owner", email: `${uid}@local.test` };
const caller = { kind: "member" as const, organizationId: org, actorId: uid };
let rateHook: () => Promise<void> = async () => {};
const acquire: RequestScopeResolver = async () => ({ commands: deps, identity: { database: resource.db, resolveSession: async headers => headers.get("Cookie") === "calendar=owner" ? { user: { id: uid, name: actor.name, email: actor.email }, session: { activeOrganizationId: org } } : null }, siteRateLimit: () => rateHook(), close: async () => {} });
const app = new Hono().route("/api", createSiteApiRoutes(acquire)).route("/api/commands", createCommandsRoute(acquire));
let calendarId: string, personId: string, secret: string, keyId: string;
const key = () => randomUUID();
const call = <K extends CalendarCommand>(command: K, input: CalendarCommands[K]) => executeCalendar(deps, caller, command, input);
const publicCall = (command: CalendarCommand, input: unknown, headers: Record<string, string> = {}) => app.request("http://fixture.test/api/commands", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}`, ...headers }, body: JSON.stringify({ command, input }) });
const range = { rangeStart: "2030-01-07T00:00:00Z", rangeEnd: "2030-01-08T00:00:00Z" };
const time = (hour: number) => ({ start: `2030-01-07T${String(hour).padStart(2, "0")}:00:00Z`, end: `2030-01-07T${String(hour).padStart(2, "0")}:30:00Z`, timeZone: "UTC" });
const grants = () => [{ calendarId, canRead: true, canReadAvailability: true, canCreate: true, canUpdate: true, canCancel: true, canManage: true }];
before(async () => {
  await resource.db.insert(organization).values({ id: org, name: "Calendar API test", slug: org });
  await resource.db.insert(user).values({ id: uid, name: actor.name, email: actor.email });
  await resource.db.insert(member).values({ id: mid, organizationId: org, userId: uid, role: "owner" });
  calendarId = (await call("createCalendar", { name: "API clinic", timeZone: "UTC", idempotencyKey: key() })).id;
  const person = await call("createCalendarPerson", { calendarId, name: "API dentist", timeZone: "UTC", idempotencyKey: key() }); personId = person.id;
  await call("setWorkingHours", { calendarId, personId, expectedVersion: 1, windows: [{ day: 1, start: "09:00", end: "17:00" }] as WorkingWindow[], idempotencyKey: key() });
  const saved = await createSiteKey(deps, actor, { name: "Calendar operations", permissions: [], calendarPermissions: grants() }); secret = saved.secret; keyId = saved.key.id;
});
after(async () => { await resource.db.delete(organization).where(eq(organization.id, org)); await resource.db.delete(user).where(eq(user.id, uid)); await resource.close(); });

test("command, REST, GraphQL and typed SDK execute the same core and return machine-readable errors", async () => {
  const input = { calendarId, personId, title: "Via command", time: time(9), idempotencyKey: key() };
  const command = await publicCall("createBooking", input); assert.equal(command.status, 200);
  const created = (await command.json()).result;
  assert.deepEqual(Object.keys(created).sort(), ["id", "revision", "status", "version"]);
  const rest = await app.request(`http://fixture.test/api/calendars/${calendarId}/bookings/${created.id}`, { headers: { Authorization: `Bearer ${secret}` } });
  assert.equal(rest.status, 200); assert.equal((await rest.json()).title, "Via command");
  const transport: typeof fetch = async (url, options) => app.request(String(url), options);
  const client = createClient({ url: "http://fixture.test", key: secret, fetch: transport });
  assert.equal((await client.calendar.getBooking({ calendarId, bookingId: created.id })).title, "Via command");
  const moved = await client.calendar.rescheduleBooking({ calendarId, bookingId: created.id, expectedVersion: 1, time: time(10), idempotencyKey: key() }); assert.equal(moved.version, 2);
  const conflict = await publicCall("createBooking", { ...input, time: time(10), idempotencyKey: key() }); assert.equal(conflict.status, 409); assert.equal((await conflict.json()).code, "RESOURCE_CONFLICT");
  await assert.rejects(client.calendar.rescheduleBooking({ calendarId, bookingId: created.id, expectedVersion: 1, time: time(11), idempotencyKey: key() }), (error: any) => error.code === "VERSION_CONFLICT");
  const list = await client.calendar.queryBookings({ calendarId, ...range }); assert(list.complete); assert.equal(list.items.length, 1);
  const cancelled = await client.calendar.cancelBooking({ calendarId, bookingId: created.id, expectedVersion: 2, idempotencyKey: key() }); assert.equal(cancelled.revision, 3);
  assert((await client.calendar.checkBookingConflicts({ calendarId, personId, time: time(10) })).available);
  const old = { calendarId, personId, rangeStart: range.rangeStart, rangeEnd: range.rangeEnd, durationMinutes: 30 };
  const alias = await app.request(`http://fixture.test/api/calendars/${calendarId}/availability/query`, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ personId, ...range, durationMinutes: 30 }) });
  assert.deepEqual(await alias.json(), await client.calendar.queryAvailability(old));
});
test("idempotency headers match all transports, member errors preserve code, and GraphQL aliases cannot multiply mutations", async () => {
  const input = { calendarId, personId, title: "Header", time: time(11) };
  const header = key();
  const accepted = await publicCall("createBooking", input, { "Idempotency-Key": header }); assert.equal(accepted.status, 200);
  assert.deepEqual(await (await publicCall("createBooking", input, { "Idempotency-Key": header })).json(), await accepted.json());
  assert.equal((await publicCall("createBooking", { ...input, idempotencyKey: key() }, { "Idempotency-Key": header })).status, 400);
  const memberResponse = await app.request("http://fixture.test/api/commands", { method: "POST", headers: { "Content-Type": "application/json", Cookie: "calendar=owner" }, body: JSON.stringify({ command: "createBooking", input: { ...input, idempotencyKey: key() } }) });
  assert.equal(memberResponse.status, 409); assert.equal((await memberResponse.json()).code, "RESOURCE_CONFLICT");
  const query = 'mutation($input:JSON!){ a:createBooking(input:$input) b:createBooking(input:$input) }';
  const denied = await app.request("http://fixture.test/api/graphql", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: JSON.stringify({ query, variables: { input: { ...input, idempotencyKey: key() } } }) });
  const deniedBody = await denied.json(); assert.equal(deniedBody.errors[0].extensions.code, "QUERY_TOO_COMPLEX"); assert(!deniedBody.data);
  const preflight = await app.request(`http://fixture.test/api/calendars/${calendarId}/bookings`, { method: "OPTIONS", headers: { Origin: "https://external.test", "Access-Control-Request-Headers": "Authorization,Idempotency-Key", "Access-Control-Request-Method": "POST" } });
  assert.match(preflight.headers.get("Access-Control-Allow-Headers")!, /Idempotency-Key/);
  const controller = new AbortController(); controller.abort();
  const sdk = createClient({ url: "http://fixture.test", key: secret, fetch: async (_url, options) => { if (options?.signal?.aborted) throw new DOMException("Abort", "AbortError"); return new Response(); } });
  await assert.rejects(sdk.calendar.queryBookings({ calendarId, ...range }, { signal: controller.signal }), { name: "AbortError" });
});
test("every shared command has real native, MCP and disable registrations; native execution calls the core with trusted scope", async () => {
  const registered = new Set(Object.values(CALENDAR_TOOLS).map(definition => definition.command));
  assert.deepEqual(registered, new Set(CALENDAR_COMMANDS));
  const catalog = getAgentToolCatalog("pi");
  const tools = createCalendarTools(deps, org, uid);
  for (const id of Object.keys(CALENDAR_TOOLS)) {
    assert(catalog.tools.some(tool => tool.id === id && tool.group === "日历与预约"));
    assert.deepEqual(DISABLED_TOOLS_SCHEMA.parse([id]), [id]); assert(tools[id].execute);
  }
  const invoke = async (name: string, input: any) => tools[name].execute!(input, { toolCallId: key(), messages: [], context: undefined }) as any;
  const availability = await invoke("query_availability", { calendarId, personId, ...range, durationMinutes: 30 });
  assert(availability.slots.length);
  const created = await invoke("create_booking", { calendarId, personId, title: "Native tool", time: time(12), idempotencyKey: key() });
  assert.equal((await call("getBooking", { calendarId, bookingId: created.id })).title, "Native tool");
  const bad = await invoke("reschedule_booking", { calendarId, bookingId: created.id, expectedVersion: 1, time: time(11), idempotencyKey: key() }); assert.equal(bad.error.code, "RESOURCE_CONFLICT");
  const memberResult = await dispatchCommand(deps, actor, { command: "getBooking", input: { calendarId, bookingId: created.id } }); assert.equal((memberResult.result as any).id, created.id);
  assert.equal((await invoke("query_availability", { calendarId, personId, ...range, durationMinutes: 30, workspaceId: randomUUID() })).error.code, "BAD_INPUT");
});
test("actual MCP stdio round-trip queries availability, creates and cancels through authenticated HTTP", { timeout: 30000 }, async () => {
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  try {
    const runner = fileURLToPath(new URL("../../../mcp/test/calendar-client.mjs", import.meta.url));
    const result = await promisify(execFile)(process.execPath, [runner], { env: { ...process.env, TABDO_API_URL: `http://127.0.0.1:${address.port}`, TABDO_API_KEY: secret, CALENDAR_MCP_TSX: createRequire(import.meta.url).resolve("tsx/cli"), CALENDAR_MCP_CASE: JSON.stringify({ availability: { calendarId, personId, ...range, durationMinutes: 30 }, booking: { calendarId, personId, title: "Real MCP", idempotencyKey: key() } }) } });
    assert.equal(JSON.parse(result.stdout).mcp, "PASS");
  } finally { if ("closeAllConnections" in server) server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
test("narrowed grants cannot replay a previously accepted create receipt", async () => {
  const input = { calendarId, personId, title: "Revocation", time: time(14), idempotencyKey: key() };
  assert.equal((await publicCall("createBooking", input)).status, 200);
  await updateSiteKey(deps, actor, keyId, { name: "No create", permissions: [], calendarPermissions: [{ ...grants()[0], canCreate: false }] });
  const denied = await publicCall("createBooking", input); assert.equal(denied.status, 403); assert.equal((await denied.json()).code, "FORBIDDEN");
});

test("a key revoked after HTTP resolution is rechecked inside the write transaction", async () => {
  const keyRecord = await createSiteKey(deps, actor, { name: "Revocation race", permissions: [], calendarPermissions: grants() });
  let arrived!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { arrived = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  rateHook = async () => { arrived(); await gate; };
  const pending = publicCall("createBooking", { calendarId, personId, title: "Must not commit", time: time(15), idempotencyKey: key() }, { Authorization: `Bearer ${keyRecord.secret}` });
  try {
    await ready;
    await updateSiteKey(deps, actor, keyRecord.key.id, { name: "Revoked create", permissions: [], calendarPermissions: [{ ...grants()[0], canCreate: false }] });
    release();
    const response = await pending;
    assert.equal(response.status, 403); assert.equal((await response.json()).code, "FORBIDDEN");
    assert((await call("checkBookingConflicts", { calendarId, personId, time: time(15) })).available);
  } finally { release(); rateHook = async () => {}; }
});
