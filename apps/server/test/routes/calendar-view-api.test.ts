import { createMcpRoute } from "../../src/mcp/route.js";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createClient } from "@tabdo/sdk";
import { createDatabase } from "../../src/business/db/factory.js";
import { organization, user, member, columns } from "../../src/business/db/schema.js";
import type { CommandDependencies } from "../../src/business/dependencies.js";
import type { Actor } from "../../src/business/auth/actor.js";
import type { RequestScopeResolver } from "../../src/business/http/request.js";
import { createSiteApiRoutes } from "../../src/business/http/site-api.js";
import { createCommandsRoute } from "../../src/business/http/commands.js";
import { createSiteKey } from "../../src/business/data-api/keys.js";
import * as commands from "../../src/business/commands/index.js";
import { createTableTools } from "../../src/business/agent/tools/index.js";
import { getAgentToolCatalog } from "../../src/harness/tool-catalog.js";
import { DISABLED_TOOLS_SCHEMA, EMPTY_DOCUMENT } from "@tabdo/shared";
const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test")); assert.equal(process.env.DATABASE_URL_UNPOOLED, url);
const resource = createDatabase({ connectionString: url, poolMax: 4 });
const org = randomUUID(), uid = randomUUID(), mid = randomUUID(), scope = { organizationId: org };
const deps: CommandDependencies = { database: resource.db, now: () => new Date(), uuid: randomUUID, automationQueueName: "unused", calendarOutbound: { encryptionKey: "11".repeat(32), send: async () => { throw new Error("Read matrix must never send HTTP"); } } };
const actor: Actor = { organizationId: org, userId: uid, memberId: mid, kind: "human", role: "owner", name: "Date API owner", email: `${uid}@local.test` };
const acquire: RequestScopeResolver = async () => ({ commands: deps, identity: { database: resource.db, resolveSession: async headers => headers.get("Cookie") === "dates=owner" ? { user: { id: uid, name: actor.name, email: actor.email }, session: { activeOrganizationId: org } } : null }, siteRateLimit: async () => {}, close: async () => {} });
const app = new Hono().route("/mcp", createMcpRoute(acquire, { publicOrigin: "http://fixture.test", allowedOrigins: [] })).route("/api", createSiteApiRoutes(acquire)).route("/api/commands", createCommandsRoute(acquire));
let tableId: string, startId: string, titleId: string, viewId: string, rowId: string, secret: string, denied: string, updateKey: string;
const range = { rangeStart: "2030-03-01", rangeEnd: "2030-04-01" };
const post = (command: string, input: unknown, key = secret) => app.request("http://fixture.test/api/commands", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ command, input }) });
before(async () => {
  await resource.db.insert(organization).values({ id: org, name: "Calendar view API", slug: org });
  await resource.db.insert(user).values({ id: uid, name: actor.name, email: actor.email });
  await resource.db.insert(member).values({ id: mid, organizationId: org, userId: uid, role: "owner" });
  tableId = (await commands.createTable(deps, { ...scope, name: "Dated records" })).id;
  titleId = (await commands.getTable(deps, { ...scope, tableId })).columns[0].id;
  startId = (await commands.addColumn(deps, { ...scope, tableId, type: "date", name: "Start" })).id;
  rowId = (await commands.addRow(deps, { ...scope, tableId, cells: { [startId]: "2030-03-02", [titleId]: "Only mapped title" } })).id;
  viewId = (await commands.createCalendarView(deps, { ...scope, tableId, config: { startColumnId: startId, titleColumnId: titleId } })).id;
  secret = (await createSiteKey(deps, actor, { name: "Read", permissions: [{ tableId, canRead: true, canCreate: false, canUpdate: false, canDelete: false }] })).secret;
  denied = (await createSiteKey(deps, actor, { name: "No read", permissions: [{ tableId, canRead: false, canCreate: true, canUpdate: false, canDelete: false }] })).secret;
  updateKey = (await createSiteKey(deps, actor, { name: "Update", permissions: [{ tableId, canRead: true, canCreate: false, canUpdate: true, canDelete: false }] })).secret;
});
after(async () => { await resource.db.delete(organization).where(eq(organization.id, org)); await resource.db.delete(user).where(eq(user.id, uid)); await resource.close(); });
test("member, public command, REST, GraphQL and SDK share calendar range projection; keys never gain view management", async () => {
  const input = { viewId, ...range };
  const response = await post("queryCalendarView", input); assert.equal(response.status, 200);
  const result = (await response.json()).result; assert.equal(result.items[0].rowId, rowId); assert.equal(result.items[0].title, "Only mapped title");
  const memberCall = await app.request("http://fixture.test/api/commands", { method: "POST", headers: { Cookie: "dates=owner", "Content-Type": "application/json" }, body: JSON.stringify({ command: "queryCalendarView", input }) });
  assert.equal(memberCall.status, 200); assert.deepEqual((await memberCall.json()).result, result);
  const rest = await app.request(`http://fixture.test/api/views/${viewId}/calendar/query`, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify(range) });
  assert.equal(rest.status, 200); assert.deepEqual(await rest.json(), result);
  const sdk = createClient({ url: "http://fixture.test", key: secret, fetch: async (url, options) => app.request(String(url), options) });
  assert.deepEqual(await sdk.queryCalendarView(input), result);
  assert.equal((await post("queryCalendarView", input, denied)).status, 403);
  for (const command of ["createCalendarView", "updateCalendarView", "deleteView", "setDefaultView"]) assert.equal((await post(command, { tableId, viewId, config: { startColumnId: startId } })).status, 403);
  assert.equal((await post("updateCells", { rowId, expectedVersion: 1, cells: { [startId]: "2030-03-03" } })).status, 403);
  assert.equal((await post("updateCells", { rowId, expectedVersion: 1, cells: { [startId]: "2030-03-03" } }, updateKey)).status, 200);
  assert.equal((await post("updateCells", { rowId, expectedVersion: 1, cells: { [startId]: "2030-03-04" } }, updateKey)).status, 409);
  await resource.db.update(columns).set({ config: { hidden: true } }).where(eq(columns.id, titleId));
  const hidden = await sdk.queryCalendarView(input); assert.deepEqual(hidden.items, []); assert.deepEqual(hidden.diagnostics.mapping, [{ field: "titleColumnId", code: "hidden" }]); assert(!JSON.stringify(hidden).includes("Only mapped title"));
});
test("calendar view tools are registered and disableable without booking semantics", () => {
  const tools = createTableTools(deps, tableId, org, uid);
  for (const id of ["create_calendar_view", "update_calendar_view", "query_calendar_view"]) {
    assert(tools[id]); assert(getAgentToolCatalog("pi").tools.some(tool => tool.id === id && tool.group === "视图")); assert.deepEqual(DISABLED_TOOLS_SCHEMA.parse([id]), [id]);
  }
});

test("native configuration/query and real MCP HTTP use the same scoped record projection", { timeout: 30000 }, async () => {
  await resource.db.update(columns).set({ config: {} }).where(eq(columns.id, titleId));
  const tools = createTableTools(deps, tableId, org, uid);
  const invoke = (name: string, input: unknown) => tools[name].execute(input, { toolCallId: randomUUID(), messages: [] });
  const native = await invoke("create_calendar_view", { tableId, name: "Native dates", config: { startColumnId: startId } });
  assert.equal(native.type, "calendar");
  await invoke("update_calendar_view", { viewId: native.id, config: { startColumnId: startId, titleColumnId: titleId } });
  const result = await invoke("query_calendar_view", { viewId: native.id, ...range });
  assert.equal(result.items[0].rowId, rowId);
  // Shared entry-point merges must retain all five read surfaces and their grants.
  await commands.createDocument(deps, { ...scope, actorId: uid, tableId, rowId, content: EMPTY_DOCUMENT, idempotencyKey: randomUUID() });
  const calendar = await commands.createCalendar(deps, { ...scope, actorId: uid, name: "Coexisting calendar", timeZone: "UTC", idempotencyKey: randomUUID() });
  const mixed = await createSiteKey(deps, actor, { name: "Combined reads",
    permissions: [{ tableId, canRead: true, canCreate: false, canUpdate: false, canDelete: false }],
    documentPermissions: [{ tableId, canRead: true, canCreate: false, canUpdate: false, canReadHistory: false, canRestore: false, canUpload: false }],
    blogPermissions: [{ tableId, canRead: true, canConfigure: false, canBuild: false, canPublish: false, canRestore: false }],
    calendarPermissions: [{ calendarId: calendar.id, canRead: true, canReadAvailability: false, canCreate: false, canUpdate: false, canCancel: false, canManage: false, canSubscribe: true, canReadDeliveries: true, canManageSubscriptions: false }],
  });
  const sdk = createClient({ url: "http://fixture.test", key: mixed.secret, fetch: async (url, options) => app.request(String(url), options) });
  assert.equal((await sdk.queryCalendarView({ viewId, ...range })).items[0].rowId, rowId);
  assert.deepEqual((await sdk.documents.getDocument({ tableId, rowId }))!.content, EMPTY_DOCUMENT);
  assert((await sdk.blogs.getBlogSources({ tableId })).items.some(item => item.rowId === rowId));
  assert.equal((await sdk.calendar.getCalendar({ calendarId: calendar.id })).id, calendar.id);
  const subscription = await sdk.calendar.createCalendarSubscription({ calendarId: calendar.id, name: "Coexisting subscription", endpoint: "https://receiver.example.test/read-matrix", eventTypes: ["booking.created"], idempotencyKey: randomUUID() });
  assert(subscription.secret);
  assert.equal((await sdk.calendar.getCalendarSubscription({ calendarId: calendar.id, subscriptionId: subscription.subscription.id })).id, subscription.subscription.id);
  assert((await sdk.calendar.listCalendarSubscriptions({ calendarId: calendar.id })).items.some(item => item.id === subscription.subscription.id));
  assert.deepEqual((await sdk.calendar.listCalendarDeliveries({ calendarId: calendar.id, subscriptionId: subscription.subscription.id })).items, []);

  const server = serve({ fetch: app.fetch, hostname: process.env.HOST ?? "127.0.0.1", port: 0 });
  if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  try {
    const runner = fileURLToPath(new URL("../fixtures/mcp/calendar-view-client.mjs", import.meta.url));
    const response = await promisify(execFile)(process.execPath, [runner], { env: { ...process.env, MCP_TEST_URL: `http://${process.env.BROWSER_API_HOST ?? "127.0.0.1"}:${address.port}/mcp`, MCP_TEST_KEY: mixed.secret, CALENDAR_VIEW_MCP_CASE: JSON.stringify({ viewId, rowId, startId, tableId, calendarId: calendar.id, subscriptionId: subscription.subscription.id }) } });
    assert.equal(JSON.parse(response.stdout).mcp, "PASS");
  } finally { if ("closeAllConnections" in server) server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
