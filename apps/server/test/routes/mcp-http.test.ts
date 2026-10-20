import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createDatabase } from "../../src/business/db/factory.js";
import { hashApiKey } from "../../src/business/auth/actor.js";
import { createSiteKey, updateSiteKey } from "../../src/business/data-api/keys.js";
import { organization, user, member, workspaces, tables, rows, columns, agentProfile, userApiKeys, fileObjects } from "../../src/business/db/schema.js";
import type { Actor } from "../../src/business/auth/actor.js";
import type { CommandDependencies } from "../../src/business/dependencies.js";
import { createMcpRoute } from "../../src/mcp/route.js";
import { createApp } from "../../src/app.js";
import { mountClientAssets } from "../../src/client-assets.js";

const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test"));
assert.equal(process.env.DATABASE_URL_UNPOOLED, url);
const resource = createDatabase({ connectionString: url, poolMax: 5 });
const db = resource.db;
const orgA = randomUUID(), orgB = randomUUID(), uidA = randomUUID(), uidB = randomUUID();
const agentA = randomUUID(), agentB = randomUUID(), profileA = randomUUID();
const agentKeyA = `agt_${randomUUID()}`, agentKeyB = `agt_${randomUUID()}`;
const tableA = randomUUID(), tableB = randomUUID(), tableOtherWorkspace = randomUUID();
const textColumn = randomUUID(), fileColumn = randomUUID(), fileId = randomUUID(), fileRow = randomUUID();
const deps: CommandDependencies = { database: db, now: () => new Date(), uuid: randomUUID, automationQueueName: "unused-mcp-http" };
let workspaceA: string, workspaceB: string, otherWorkspace: string;
let secretA: string, secretB: string, keyA: string;
let acquired = 0, closed = 0, sessions = 0;
const app = new Hono().route("/mcp", createMcpRoute(async () => {
  acquired++;
  return { commands: deps, identity: { database: db, resolveSession: async () => { sessions++; throw new Error("MCP must never use a session"); } }, siteRateLimit: async () => {}, close: async () => { closed++; } };
}, { publicOrigin: "https://tabdo.example.test", allowedOrigins: ["https://trusted.example.test"] }));
let server: ReturnType<typeof serve>, endpoint: string;
const clients: Client[] = [];
const value = (result: Awaited<ReturnType<Client["callTool"]>>) => {
  assert(!result.isError, JSON.stringify(result));
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0].text);
};
async function connect(key: string, workspace?: string) {
  const client = new Client({ name: "remote-mcp-regression", version: "1" }); clients.push(client);
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: {
    Authorization: `Bearer ${key}`, ...(workspace ? { "X-Workspace-Id": workspace } : {}),
  } } });
  await client.connect(transport);
  assert.equal(transport.sessionId, undefined);
  return client;
}
const rpc = (key: string, body: unknown, headers: Record<string, string> = {}) => fetch(endpoint, {
  method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body),
});
const listRequest = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const actor: Actor = { kind: "human", userId: uidA, memberId: uidA, organizationId: orgA, role: "owner", name: "MCP owner", email: `${uidA}@local.test` };
const permission = (tableId: string, writable = true) => ({ tableId, canRead: true, canCreate: writable, canUpdate: writable, canDelete: writable });
before(async () => {
  await db.insert(organization).values([{ id: orgA, name: "MCP A", slug: orgA }, { id: orgB, name: "MCP B", slug: orgB }]);
  await db.insert(user).values([uidA, uidB, agentA, agentB].map(id => ({ id, name: id, email: `${id}@local.test`, kind: id === agentA || id === agentB ? "agent" : "human" })));
  await db.insert(member).values([uidA, agentA].map(id => ({ id, userId: id, organizationId: orgA, role: "owner" })).concat([uidB, agentB].map(id => ({ id, userId: id, organizationId: orgB, role: "owner" }))));
  await db.insert(agentProfile).values([
    { id: profileA, organizationId: orgA, memberId: agentA, userId: agentA, displayName: "Agent A", apiKeyHash: await hashApiKey(agentKeyA) },
    { id: randomUUID(), organizationId: orgB, memberId: agentB, userId: agentB, displayName: "Agent B", apiKeyHash: await hashApiKey(agentKeyB) },
  ]);
  const defaults = await db.select().from(workspaces);
  workspaceA = defaults.find(w => w.organizationId === orgA && w.isDefault)!.id;
  workspaceB = defaults.find(w => w.organizationId === orgB && w.isDefault)!.id;
  otherWorkspace = (await db.insert(workspaces).values({ organizationId: orgA, name: "MCP other" }).returning())[0].id;
  await db.insert(tables).values([
    { id: tableA, organizationId: orgA, workspaceId: workspaceA, name: "A" },
    { id: tableB, organizationId: orgB, workspaceId: workspaceB, name: "B" },
    { id: tableOtherWorkspace, organizationId: orgA, workspaceId: otherWorkspace, name: "A other" },
  ]);
  await db.insert(columns).values([{ id: textColumn, tableId: tableA, name: "Title", type: "text" }, { id: fileColumn, tableId: tableA, name: "Attachment", type: "file", sortOrder: 1 }]);
  await db.insert(fileObjects).values({ id: fileId, organizationId: orgA, workspaceId: workspaceA, tableId: tableA, columnId: fileColumn, name: "fixture.txt", size: 7, mimeType: "text/plain", storageDriver: "local", storageKey: `mcp-test/${fileId}` });
  await db.insert(rows).values({ id: fileRow, tableId: tableA, cells: { [textColumn]: "fixture", [fileColumn]: [fileId] } });
  const a = await createSiteKey(deps, actor, { name: "MCP A", permissions: [permission(tableA)] }); secretA = a.secret; keyA = a.key.id;
  const b = await createSiteKey(deps, { ...actor, userId: uidB, memberId: uidB, organizationId: orgB }, { name: "MCP B", permissions: [permission(tableB)] }); secretB = b.secret;
  server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
  const address = server.address(); assert(address && typeof address !== "string"); endpoint = `http://127.0.0.1:${address.port}/mcp`;
});
after(async () => {
  await Promise.all(clients.map(client => client.close()));
  if (server && "closeAllConnections" in server) server.closeAllConnections();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  try {
    await db.delete(organization).where(eq(organization.id, orgA)); await db.delete(organization).where(eq(organization.id, orgB));
    for (const id of [uidA, uidB, agentA, agentB]) await db.delete(user).where(eq(user.id, id));
  } finally { await resource.close(); }
  assert.equal(acquired, closed, "every acquired request scope is released");
  assert.equal(sessions, 0, "no Cookie or anonymous session fallback");
});

test("official HTTP client initializes and lists exactly the former tool directory and schemas", async () => {
  const client = await connect(secretA);
  const catalog = (await client.listTools()).tools;
  // Captured using the official client against the pre-migration registry at
  // 09bcc32c69fd80d53323ff14bca793e912646d0c; each hash covers the full tool definition.
  const baseline = JSON.parse(await readFile(new URL("../fixtures/mcp/catalog.json", import.meta.url), "utf8"));
  assert.equal(catalog.length, 103); assert.deepEqual(catalog.map(tool => ({ name: tool.name, sha256: createHash("sha256").update(JSON.stringify(tool)).digest("hex") })), baseline);
  const response = await rpc(secretA, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(response.status, 202); assert.equal(await response.text(), "");
  assert.equal(response.headers.get("mcp-session-id"), null);
});

test("real authorized read/write/delete honors grants, errors and never returns API keys in file URLs", async () => {
  const client = await connect(secretA);
  assert.deepEqual(value(await client.callTool({ name: "list_tables" })).map((t: { id: string }) => t.id), [tableA]);
  const read = value(await client.callTool({ name: "query_rows", arguments: { tableId: tableA, limit: 10 } }));
  const fileUrl = read.rows[0].files[0].url;
  assert.equal(new URL(fileUrl).origin, "https://tabdo.example.test"); assert.equal(new URL(fileUrl).search, "");
  assert(!JSON.stringify(read).includes(secretA));
  const created = value(await client.callTool({ name: "add_row", arguments: { tableId: tableA, cells: { [textColumn]: "Remote write" } } }));
  assert.equal((await db.select().from(rows).where(eq(rows.id, created.id)))[0].cells[textColumn], "Remote write");
  assert.equal(value(await client.callTool({ name: "get_row", arguments: { rowId: created.id } })).cells[textColumn], "Remote write");
  await updateSiteKey(deps, actor, keyA, { name: "MCP A read only", permissions: [permission(tableA, false)] });
  const denied = await client.callTool({ name: "add_row", arguments: { tableId: tableA, cells: {} } }); assert.equal(denied.isError, true);
  assert.match(JSON.stringify(denied), /does not allow create/);
  assert.equal((await client.callTool({ name: "get_table", arguments: { tableId: tableB } })).isError, true);
  assert.equal((await client.callTool({ name: "create_table", arguments: { name: "Denied" } })).isError, true);
  assert.equal((await client.callTool({ name: "add_row", arguments: {} })).isError, true);
  await updateSiteKey(deps, actor, keyA, { name: "MCP A", permissions: [permission(tableA)] });
  value(await client.callTool({ name: "delete_row", arguments: { rowId: created.id } }));
  assert.equal((await db.select().from(rows).where(eq(rows.id, created.id))).length, 0);
});

test("concurrent Keys and agent workspace selectors never share identity", async () => {
  const a = await connect(secretA), b = await connect(secretB);
  await Promise.all(Array.from({ length: 8 }, async (_, index) => {
    const result = value(await (index % 2 ? a : b).callTool({ name: "list_tables" }));
    assert.deepEqual(result.map((t: { id: string }) => t.id), [index % 2 ? tableA : tableB]);
  }));
  const agent = await connect(agentKeyA, otherWorkspace);
  assert.equal(value(await agent.callTool({ name: "get_workspace", arguments: {} })).workspace.id, otherWorkspace);
  assert.deepEqual(value(await agent.callTool({ name: "list_tables" })).map((t: { id: string }) => t.id), [tableOtherWorkspace]);
  assert.equal((await agent.callTool({ name: "get_table", arguments: { tableId: tableA } })).isError, true);
  assert.equal((await rpc(agentKeyA, listRequest, { "X-Workspace-Id": workspaceB })).status, 403);
  assert.equal((await rpc(secretA, listRequest, { "X-Workspace-Id": workspaceB })).status, 403);
  const other = await connect(agentKeyB);
  assert.equal(value(await other.callTool({ name: "get_workspace", arguments: {} })).workspace.id, workspaceB);
  // Revocation invalidates an already initialized official client on the next request.
  await db.update(agentProfile).set({ apiKeyHash: null }).where(eq(agentProfile.id, profileA));
  await assert.rejects(agent.listTools(), { code: 401 });
  await db.update(userApiKeys).set({ revokedAt: new Date() }).where(eq(userApiKeys.id, keyA));
  await assert.rejects(a.listTools(), { code: 401 });
  await db.update(userApiKeys).set({ revokedAt: null }).where(eq(userApiKeys.id, keyA));
  assert.equal((await rpc(secretB, listRequest)).status, 200);
  await db.delete(member).where(eq(member.id, agentB));
  await assert.rejects(other.listTools(), { code: 401 });
});

test("authentication, Origin, protocol headers, malformed bodies and methods follow HTTP boundaries", async () => {
  for (const headers of ([{}, { Cookie: "session=anything" }, { Authorization: "Bearer invalid", Cookie: "session=anything" }, { "MCP-Session-Id": "some-initialized-session" }] as Record<string, string>[])) {
    const response = await fetch(endpoint, { headers }); assert.equal(response.status, 401); assert.equal(response.headers.get("www-authenticate"), "Bearer");
  }
  assert.equal((await fetch(endpoint + "?key=" + secretB)).status, 401);
  for (const origin of ["https://evil.example.test", "null", "http://127.0.0.1"]) assert.equal((await rpc(secretB, listRequest, { Origin: origin })).status, 403);
  const cors = await rpc(secretB, listRequest, { Origin: "https://trusted.example.test" });
  assert.equal(cors.status, 200); assert.equal(cors.headers.get("access-control-allow-origin"), "https://trusted.example.test"); assert.equal(cors.headers.get("access-control-allow-credentials"), null);
  const preflight = await fetch(endpoint, { method: "OPTIONS", headers: { Origin: "https://trusted.example.test", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Authorization,MCP-Protocol-Version,X-Workspace-Id" } });
  assert.equal(preflight.status, 204); assert.match(preflight.headers.get("access-control-allow-headers")!, /MCP-Protocol-Version/i);
  assert.equal((await rpc(secretB, listRequest, { Accept: "application/json" })).status, 406);
  assert.equal((await rpc(secretB, listRequest, { "MCP-Protocol-Version": "unsupported" })).status, 400);
  assert.equal((await rpc(secretB, listRequest, { "Content-Type": "text/plain" })).status, 415);
  const malformed = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${secretB}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: "{" }); assert.equal(malformed.status, 400);
  for (const method of ["GET", "DELETE", "PUT", "PATCH"]) assert.equal((await fetch(endpoint, { method, headers: { Authorization: `Bearer ${secretB}`, Accept: "text/event-stream" } })).status, 405);
  const oversized = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${secretB}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: " ".repeat(8 * 1024 * 1024 + 1) }); assert.equal(oversized.status, 413);
  assert.equal((await rpc(secretB, listRequest)).status, 200, "transport errors do not poison the next request");
});

test("deployed app mounts /mcp before SPA fallback even when AUTH_REQUIRED=false", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tabdo-mcp-assets-"));
  const previous = process.env.AUTH_REQUIRED; process.env.AUTH_REQUIRED = "false";
  try {
    await writeFile(join(directory, "index.html"), "<html>SPA fixture</html>");
    const deployed = createApp({ appUrl: "https://trusted.example.test", resources: { database: resource } });
    mountClientAssets(deployed, directory);
    const denied = await deployed.request("/mcp"); assert.equal(denied.status, 401); assert.match(denied.headers.get("content-type")!, /json/);
    assert.equal((await deployed.request("/mcp/nested")).status, 404);
    assert.equal((await deployed.request("/mcp", { method: "GET", headers: { Authorization: `Bearer ${secretB}` } })).status, 405);
    const response = await deployed.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${secretB}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(listRequest) });
    assert.equal(response.status, 200); assert.equal((await response.json()).result.tools.length, 103);
  } finally {
    if (previous === undefined) delete process.env.AUTH_REQUIRED; else process.env.AUTH_REQUIRED = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
