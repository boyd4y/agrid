import { createMcpRoute } from "../../src/mcp/route.js";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDatabase } from "../../src/business/db/factory.js";
import { organization, user, member, calendarDeliveries } from "../../src/business/db/schema.js";
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
const deps: CommandDependencies = { database: resource.db, now: () => new Date("2029-01-01T00:00:00Z"), uuid: randomUUID, automationQueueName: "unused", calendarOutbound: { encryptionKey: "11".repeat(32), send: async () => ({ httpStatus: 204, error: null }) } };
const actor: Actor = { organizationId: org, userId: uid, memberId: mid, kind: "human", role: "owner", name: "API calendar owner", email: `${uid}@local.test` };
const caller = { kind: "member" as const, organizationId: org, actorId: uid };
let rateHook: () => Promise<void> = async () => {};
const acquire: RequestScopeResolver = async () => ({ commands: deps, identity: { database: resource.db, resolveSession: async headers => headers.get("Cookie") === "calendar=owner" ? { user: { id: uid, name: actor.name, email: actor.email }, session: { activeOrganizationId: org } } : null }, siteRateLimit: () => rateHook(), close: async () => {} });
const app = new Hono().route("/mcp", createMcpRoute(acquire, { publicOrigin: "http://fixture.test", allowedOrigins: [] })).route("/api", createSiteApiRoutes(acquire)).route("/api/commands", createCommandsRoute(acquire));
let calendarId: string, personId: string, secret: string, keyId: string;
const key = () => randomUUID();
const call = <K extends CalendarCommand>(command: K, input: CalendarCommands[K]) => executeCalendar(deps, caller, command, input);
const publicCall = (command: CalendarCommand, input: unknown, headers: Record<string, string> = {}) => app.request("http://fixture.test/api/commands", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}`, ...headers }, body: JSON.stringify({ command, input }) });
const range = { rangeStart: "2030-01-07T00:00:00Z", rangeEnd: "2030-01-08T00:00:00Z" };
const time = (hour: number) => ({ start: `2030-01-07T${String(hour).padStart(2, "0")}:00:00Z`, end: `2030-01-07T${String(hour).padStart(2, "0")}:30:00Z`, timeZone: "UTC" });
const grants = () => [{ calendarId, canRead: true, canUpdate: true, canDelete: true, canCreate: true }];
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
test("actual MCP HTTP round-trip queries availability, creates and cancels through authenticated HTTP", { timeout: 30000 }, async () => {
  const server = serve({ fetch: app.fetch, hostname: process.env.HOST ?? "127.0.0.1", port: 0 });
  if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  try {
    const runner = fileURLToPath(new URL("../fixtures/mcp/calendar-client.mjs", import.meta.url));
    const result = await promisify(execFile)(process.execPath, [runner], { env: { ...process.env, MCP_TEST_URL: `http://${process.env.BROWSER_API_HOST ?? "127.0.0.1"}:${address.port}/mcp`, MCP_TEST_KEY: secret, CALENDAR_MCP_CASE: JSON.stringify({ availability: { calendarId, personId, ...range, durationMinutes: 30 }, booking: { calendarId, personId, title: "Real MCP", idempotencyKey: key() } }) } });
    assert.equal(JSON.parse(result.stdout).mcp, "PASS");
  } finally { if ("closeAllConnections" in server) server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
test("subscription CRUD, delivery history and explicit retry align across REST, GraphQL, SDK, native and real MCP", { timeout: 30000 }, async () => {
  const transport: typeof fetch = async (url, options) => app.request(String(url), options);
  const client = createClient({ url: "http://fixture.test", key: secret, fetch: transport });
  const endpoint = `http://fixture.test/api/calendars/${calendarId}/subscriptions`;
  const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
  const created = await app.request(endpoint, { method: "POST", headers, body: JSON.stringify({ name: "API outgoing", endpoint: "https://receiver.example.test/events", eventTypes: ["booking.created"], idempotencyKey: key() }) });
  assert.equal(created.status, 200); const { subscription, secret: signingSecret } = await created.json(); assert(signingSecret);
  const subscriptionId = subscription.id;
  const list = await client.calendar.listCalendarSubscriptions({ calendarId, limit: 1 }); assert.equal(list.items[0].id, subscriptionId); assert(!JSON.stringify(list).includes(signingSecret));
  assert.equal((await client.calendar.getCalendarSubscription({ calendarId, subscriptionId })).id, subscriptionId);
  const b = await call("createBooking", { calendarId, personId, title: "API outgoing booking", time: time(16), idempotencyKey: key() });
  const deliveries = await client.calendar.listCalendarDeliveries({ calendarId, subscriptionId }); assert.equal(deliveries.items.length, 1);
  const deliveryId = deliveries.items[0].id;
  const detail = await app.request(`${endpoint}/${subscriptionId}/deliveries/${deliveryId}`, { headers }); assert.equal(detail.status, 200); assert.equal((await detail.json()).attempts.length, 0);
  await resource.db.update(calendarDeliveries).set({ status: "deadletter" }).where(eq(calendarDeliveries.id, deliveryId));
  assert.equal((await client.calendar.retryCalendarDelivery({ calendarId, subscriptionId, deliveryId, expectedVersion: 1, idempotencyKey: key() })).id, deliveryId);
  assert.equal((await client.calendar.getBooking({ calendarId, bookingId: b.id })).version, 1);
  const server = serve({ fetch: app.fetch, hostname: process.env.HOST ?? "127.0.0.1", port: 0 });
  if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  try {
    const calls = [
      { name: "list_calendar_subscriptions", input: { calendarId }, expect: { "items.0.id": subscriptionId }, absent: [signingSecret] },
      { name: "get_calendar_subscription", input: { calendarId, subscriptionId }, expect: { id: subscriptionId } },
      { name: "list_calendar_deliveries", input: { calendarId, subscriptionId }, expect: { "items.0.id": deliveryId } },
      { name: "get_calendar_delivery", input: { calendarId, subscriptionId, deliveryId }, expect: { "delivery.id": deliveryId } },
    ];
    const result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL("../fixtures/mcp/calendar-client.mjs", import.meta.url))], { env: { ...process.env, MCP_TEST_URL: `http://${process.env.BROWSER_API_HOST ?? "127.0.0.1"}:${address.port}/mcp`, MCP_TEST_KEY: secret, CALENDAR_MCP_CASE: JSON.stringify({ calls }) } });
    assert.equal(JSON.parse(result.stdout).operations, calls.length);
  } finally { if ("closeAllConnections" in server) server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  const paused = await client.calendar.updateCalendarSubscription({ calendarId, subscriptionId, name: subscription.name, endpoint: subscription.endpoint, eventTypes: subscription.eventTypes, status: "paused", expectedVersion: 1, idempotencyKey: key() }); assert.equal(paused.version, 2);
  const rotated = await client.calendar.rotateCalendarSubscriptionSecret({ calendarId, subscriptionId, expectedVersion: 2, idempotencyKey: key() }); assert(rotated.secret); assert.notEqual(rotated.secret, signingSecret);
  const native = createCalendarTools(deps, org, uid);
  const memberCreated = await native.create_calendar_subscription.execute!({ calendarId, name: "Native subscription", endpoint: "https://receiver.example.test/native", eventTypes: ["booking.created"], idempotencyKey: key() }, { toolCallId: key(), messages: [], context: undefined }) as any; assert(memberCreated.secret);
  const result = await dispatchCommand(deps, actor, { command: "listCalendarSubscriptions", input: { calendarId } }); assert((result.result as any).items.some((v: any) => v.id === memberCreated.subscription.id));
  const revoked = await app.request(`${endpoint}/${subscriptionId}/revoke`, { method: "POST", headers, body: JSON.stringify({ expectedVersion: 3, idempotencyKey: key() }) }); assert.equal(revoked.status, 200); assert.equal((await revoked.json()).status, "revoked");
  assert.equal((await client.calendar.getCalendarDelivery({ calendarId, subscriptionId, deliveryId })).delivery.status, "skipped");
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

test("system-member event contract reaches command, typed SDK, native tools and actual MCP", { timeout: 30000 }, async () => {
  const eventKey = await createSiteKey(deps, actor, { name: "Member event contract", permissions: [], calendarPermissions: grants() });
  const transport: typeof fetch = async (url, options) => app.request(String(url), options);
  const sdk = createClient({ url: "http://fixture.test", key: eventKey.secret, fetch: transport });
  const directory = await sdk.calendar.listCalendarMembers({ calendarId }); assert(directory.items.some(item => item.userId === uid));
  const response = await publicCall("createBooking", { calendarId, userId: uid, title: "System member", time: time(1), idempotencyKey: key() }, { Authorization: `Bearer ${eventKey.secret}` });
  assert.equal(response.status, 200); const created = (await response.json()).result;
  const actual = await sdk.calendar.getBooking({ calendarId, bookingId: created.id }); assert.equal(actual.schedulingMode, "member"); assert.equal(actual.userId, uid);
  await sdk.calendar.rescheduleBooking({ calendarId, bookingId: created.id, expectedVersion: 1, title: "SDK edited", time: time(2), idempotencyKey: key() });
  const tools = createCalendarTools(deps, org, uid);
  const invoke = (name: string, input: any) => tools[name].execute!(input, { toolCallId: key(), messages: [], context: undefined }) as any;
  assert((await invoke("list_calendar_members", { calendarId })).items.some((item: any) => item.userId === uid));
  const native = await invoke("create_booking", { calendarId, userId: uid, title: "Native member", time: time(3), idempotencyKey: key() });
  assert.equal((await sdk.calendar.getBooking({ calendarId, bookingId: native.id })).userId, uid);
  const server = serve({ fetch: app.fetch, hostname: process.env.HOST ?? "127.0.0.1", port: 0 });
  if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  try {
    const runner = fileURLToPath(new URL("../fixtures/mcp/calendar-client.mjs", import.meta.url));
    const result = await promisify(execFile)(process.execPath, [runner], { env: { ...process.env, MCP_TEST_URL: `http://${process.env.BROWSER_API_HOST ?? "127.0.0.1"}:${address.port}/mcp`, MCP_TEST_KEY: eventKey.secret, CALENDAR_MCP_CASE: JSON.stringify({ calls: [
      { name: "list_calendar_members", input: { calendarId }, includes: [uid] },
      { name: "create_booking", input: { calendarId, userId: uid, title: "MCP member", time: time(4), idempotencyKey: key() }, expect: { status: "confirmed", version: 1 } },
      { name: "reschedule_booking", input: { calendarId, bookingId: created.id, expectedVersion: 2, title: "MCP edited", time: time(5), idempotencyKey: key() }, expect: { version: 3 } },
      { name: "cancel_booking", input: { calendarId, bookingId: created.id, expectedVersion: 3, idempotencyKey: key() }, expect: { status: "cancelled" } },
    ] }) } });
    assert.equal(JSON.parse(result.stdout).mcp, "PASS");
  } finally { if ("closeAllConnections" in server) server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
