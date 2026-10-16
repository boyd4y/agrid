import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { getIntrospectionQuery } from "graphql";
import { Hono } from "hono";
import { createLocalStorage } from "@tabdo/storage/local";
import { createDatabase } from "../../src/business/db/factory.js";
import { organization, user, member, columns, rows, automationEvents, automationOutbox } from "../../src/business/db/schema.js";
import { createSiteApiRoutes, createSiteKeysRoute } from "../../src/business/http/site-api.js";
import { createRowsRoute } from "../../src/business/http/rows.js";
import { createCommandsRoute } from "../../src/business/http/commands.js";
import type { RequestScopeResolver } from "../../src/business/http/request.js";
import type { Actor } from "../../src/business/auth/actor.js";
import { createApiKey } from "@tabdo/auth/api-keys";
import { createTable, getTable, addColumn, addRow, updateCells, createAutomation } from "../../src/business/commands/index.js";
import { createSiteKey, updateSiteKey, resolveSiteKey } from "../../src/business/data-api/keys.js";
import { uploadFiles } from "../../src/business/services/files.js";
import { ServiceError } from "../../src/business/errors.js";
import { createClient } from "@tabdo/sdk";

const connectionString = process.env.DATABASE_URL ?? "";
assert(new URL(connectionString).pathname.endsWith("_agent_test"));
const resource = createDatabase({ connectionString, poolMax: 4 });
const org = randomUUID(), foreignOrg = randomUUID(), userId = randomUUID(), memberId = randomUUID();
const actor: Actor = { organizationId: org, userId, memberId, kind: "human", role: "owner", name: "Site API owner", email: `${userId}@local.test` };
const wakeups: unknown[] = [];
const deps = { database: resource.db, now: () => new Date(), uuid: randomUUID, automationQueueName: "fixture",
  wakeAfterCommit: (tx: Parameters<typeof resource.afterCommit>[0], hint: unknown) => resource.afterCommit(tx, "site-test", () => { wakeups.push(hint); }) };
let directory = "", personalKey = "", readKey = "", createKey = "", bothKey = "", bothId = "";
let tableId = "", privateTableId = "", foreignTableId = "", titleId = "", numberId = "", rowId = "", relationId = "", rollupId = "", fileColumnId = "", fileId = "";
let limited = false, unavailable = false, acquired = 0, closed = 0;
const files = { storage: () => ({ ...createLocalStorage(directory), driver: "local" as const }), limits: { maxBodyBytes: 1000000, maxFileBytes: 1000000, maxFiles: 10 } };
const acquire: RequestScopeResolver = async () => { acquired++; return {
  commands: deps, files, identity: { database: resource.db, resolveSession: async () => null },
  async siteRateLimit() { if (limited) throw new ServiceError(429, { message: "Limited" }); if (unavailable) throw new ServiceError(503, { message: "Unavailable" }); },
  async close() { closed++; },
}; };
const app = new Hono().route("/api", createSiteApiRoutes(acquire, { publicOrigin: "https://fixture.test" })).route("/api/site-keys", createSiteKeysRoute(acquire))
  .route("/api", createRowsRoute(acquire)).route("/api/commands", createCommandsRoute(acquire));
const gql = async (query: string, variables: Record<string, unknown> = {}, key = readKey) => {
  const response = await app.request("https://fixture.test/api/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Tabdo-Key": key, Origin: "https://landing.test" }, body: JSON.stringify({ query, variables }) });
  return { response, body: await response.json() };
};
const manage = (path: string, body?: unknown, method = body === undefined ? "GET" : "POST", key = personalKey) => app.request(`https://fixture.test/api/site-keys${path}`, { method,
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "tabdo-site-test-"));
  await resource.db.insert(organization).values([{ id: org, name: "Site API", slug: org }, { id: foreignOrg, name: "Foreign", slug: foreignOrg }]);
  await resource.db.insert(user).values({ id: userId, name: actor.name, email: actor.email, kind: "human" });
  await resource.db.insert(member).values({ id: memberId, organizationId: org, userId, role: "owner" });
  personalKey = (await createApiKey(deps, actor, { name: "Owner" })).secret;
  tableId = (await createTable(deps, { organizationId: org, name: "Public catalog" })).id;
  privateTableId = (await createTable(deps, { organizationId: org, name: "Private catalog" })).id;
  foreignTableId = (await createTable(deps, { organizationId: foreignOrg, name: "Foreign catalog" })).id;
  titleId = (await getTable(deps, { tableId, organizationId: org })).columns[0].id;
  numberId = (await addColumn(deps, { tableId, organizationId: org, name: "Price", type: "number" })).id;
  relationId = (await addColumn(deps, { tableId, organizationId: org, name: "Private links", type: "relation", config: { relation: { targetTableId: privateTableId, inverseName: "Backlinks" } } })).id;
  rollupId = (await addColumn(deps, { tableId, organizationId: org, name: "Private count", type: "rollup", config: { rollup: { relationColumnId: relationId, operation: "count" } } })).id;
  fileColumnId = (await addColumn(deps, { tableId, organizationId: org, name: "Images", type: "file" })).id;
  const privateTitle = (await getTable(deps, { tableId: privateTableId, organizationId: org })).columns[0].id;
  const privateRow = await addRow(deps, { tableId: privateTableId, organizationId: org, cells: { [privateTitle]: "Never expose this title" } });
  rowId = (await addRow(deps, { tableId, organizationId: org, cells: { [titleId]: "Product A", [numberId]: 9, [relationId]: [privateRow.id] } })).id;
  await addRow(deps, { tableId, organizationId: org, cells: { [titleId]: "Product B", [numberId]: 21 } });
  fileId = (await uploadFiles({ ...deps, ...files }, org, tableId, fileColumnId, [new File([Uint8Array.from([137,80,78,71])], "image.png", { type: "image/png" })])).files[0].id;
  await updateCells(deps, { rowId, organizationId: org, cells: { [fileColumnId]: [fileId] } });
  for (const kind of ["read", "create", "both"]) {
    const key = await createSiteKey(deps, actor, { name: kind, tableIds: [tableId], canRead: kind !== "create", canCreate: kind !== "read" });
    if (kind === "read") readKey = key.secret; else if (kind === "create") createKey = key.secret; else { bothKey = key.secret; bothId = key.key.id; }
  }
});
after(async () => {
  await resource.db.delete(automationEvents).where(eq(automationEvents.organizationId, org));
  for (const id of [org, foreignOrg]) await resource.db.delete(organization).where(eq(organization.id, id));
  await resource.db.delete(user).where(eq(user.id, userId));
  await resource.close(); await rm(directory, { recursive: true, force: true });
});

test("site key management is workspace admin-only, hashed, scoped, editable and physically deletable", async () => {
  assert.equal((await manage("", undefined, "GET", "")).status, 401);
  assert.equal((await manage("", undefined, "GET", readKey)).status, 401);
  const input = { name: "New site", tableIds: [tableId], canRead: true, canCreate: false };
  assert.equal((await manage("", { ...input, tableIds: [foreignTableId] })).status, 400);
  assert.equal((await manage("", { ...input, canRead: false })).status, 400);
  const created = await manage("", input); assert.equal(created.status, 201);
  const body = await created.json(); assert.match(body.secret, /^tab_pub_/);
  const listing = await (await manage("")).json(); assert(!JSON.stringify(listing).includes(body.secret)); assert(!JSON.stringify(listing).includes("keyHash"));
  await resource.db.update(member).set({ role: "member" }).where(eq(member.id, memberId));
  try { assert.equal((await manage("")).status, 403); } finally { await resource.db.update(member).set({ role: "owner" }).where(eq(member.id, memberId)); }
  assert.equal((await manage('/'+body.key.id, { ...input, tableIds: [privateTableId] }, "PATCH")).status, 200);
  assert((await resolveSiteKey(resource.db, body.secret)).tableIds.has(privateTableId));
  assert.equal((await manage('/'+body.key.id, undefined, "DELETE")).status, 200);
  await assert.rejects(resolveSiteKey(resource.db, body.secret), /Invalid site/);
});

test("standard GraphQL scopes tables, columns, rows and cursors and does not expand private linked data", async () => {
  const { response, body } = await gql('query { tables { id columns { id name type readable writable } rows(options:{limit:1,includeTotal:true}) { rows { id cells } hasMore nextCursor totalMatched limit } } }');
  assert.equal(response.status, 200); assert(!body.errors, JSON.stringify(body));
  assert.equal(body.data.tables.length, 1); const table = body.data.tables[0];
  assert.equal(table.id, tableId); assert.equal(table.rows.rows.length, 1); assert.equal(table.rows.totalMatched, 2); assert(table.rows.hasMore);
  const cells = table.rows.rows[0].cells; assert.equal(cells[relationId], null); assert.equal(cells[rollupId], null);
  assert(!JSON.stringify(body).includes("Never expose this title"));
  const next = await gql('query($id:ID!,$options:RowsInput) { table(id:$id) { rows(options:$options) { rows { id } hasMore } } }', { id: tableId, options: { limit: 1, cursor: table.rows.nextCursor } });
  assert(!next.body.data.table.rows.hasMore); assert.notEqual(next.body.data.table.rows.rows[0].id, table.rows.rows[0].id);
  for (const id of [privateTableId, foreignTableId]) assert((await gql('query($id:ID!) { table(id:$id) { id } }', { id })).body.errors);
  const filtered = await gql('query($id:ID!,$options:RowsInput) { table(id:$id) { rows(options:$options) { rows { id cells } } } }', { id: tableId, options: { filters: [{ columnId: numberId, op: "gt", value: 10 }], sort: { columnId: numberId, direction: "desc" } } });
  assert.equal(filtered.body.data.table.rows.rows.length, 1); assert.equal(filtered.body.data.table.rows.rows[0].cells[numberId], 21);
  assert((await gql('query($id:ID!,$options:RowsInput) { table(id:$id) { rows(options:$options) { hasMore } } }', { id: tableId, options: { filters: [{ columnId: rollupId, op: "gt", value: 0 }] } })).body.errors);
  const schema = await gql(getIntrospectionQuery()); assert(!schema.body.errors, JSON.stringify(schema.body.errors));
  assert.equal(schema.body.data.__schema.queryType.name, "Query");
});

test("read-only and create-only capabilities stay separate; public keys never become REST or command identities", async () => {
  const mutation = 'mutation($id:ID!,$cells:JSON!) { createRow(tableId:$id,cells:$cells) { id createdAt } }';
  assert((await gql(mutation, { id: tableId, cells: { [titleId]: "Denied" } })).body.errors);
  assert((await gql('query($id:ID!){table(id:$id){rows{rows{id}}}}', { id: tableId }, createKey)).body.errors);
  const metadata = await gql('query($id:ID!){table(id:$id){columns{id writable}}}', { id: tableId }, createKey); assert(metadata.body.data.table.columns.length);
  for (const cells of [{ [relationId]: [] }, { [fileColumnId]: [fileId] }, { [numberId]: "bad" }, { [randomUUID()]: "unknown" }]) {
    assert((await gql(mutation, { id: tableId, cells }, createKey)).body.errors);
  }
  const accepted = await gql(mutation, { id: tableId, cells: { [titleId]: "Website submission", [numberId]: 3 } }, createKey);
  assert(!accepted.body.errors, JSON.stringify(accepted.body)); assert.deepEqual(Object.keys(accepted.body.data.createRow).sort(), ["createdAt", "id"]);
  assert((await gql(mutation, { id: privateTableId, cells: {} }, createKey)).body.errors);
  for (const path of [`/api/tables/${tableId}/rows`, "/api/commands"]) {
    const result = await app.request("https://fixture.test"+path, { method: "POST", headers: { Authorization: `Bearer ${bothKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ command: "listTables", input: {} }) });
    assert.equal(result.status, 401);
  }
});

test("public creates use the ordinary atomic automation outbox and only wake after commit", async () => {
  await createAutomation(deps, { tableId, organizationId: org, name: "Website follow-up", actorId: userId, trigger: { type: "row_created" }, actions: [{ type: "update_field", columnId: numberId, value: 42 }] });
  const before = wakeups.length;
  const result = await gql('mutation($id:ID!,$cells:JSON!){createRow(tableId:$id,cells:$cells){id}}', { id: tableId, cells: { [titleId]: "Queue submission" } }, createKey);
  assert(!result.body.errors, JSON.stringify(result.body));
  const events = await resource.db.select().from(automationEvents).where(eq(automationEvents.rowId, result.body.data.createRow.id));
  assert.equal(events.length, 1); assert.equal(events[0].snapshot.actorId, null);
  assert.equal((await resource.db.select().from(automationOutbox).where(eq(automationOutbox.eventId, events[0].id))).length, 1);
  assert.equal(wakeups.length, before + 1);
  const countBefore = (await resource.db.select().from(rows).where(eq(rows.tableId, tableId))).length;
  await gql('mutation($id:ID!,$cells:JSON!){createRow(tableId:$id,cells:$cells){id}}', { id: tableId, cells: { [numberId]: "wrong" } }, createKey);
  assert.equal((await resource.db.select().from(rows).where(eq(rows.tableId, tableId))).length, countBefore);
});

test("image URLs reauthorize the key, table, row and exact file reference on every access", async () => {
  const result = await gql('query($id:ID!,$row:ID!){table(id:$id){row(id:$row){files{id columnId url}}}}', { id: tableId, row: rowId });
  const url = result.body.data.table.row.files[0].url;
  const proxied = await app.request("http://internal-node/api/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Tabdo-Key": readKey }, body: JSON.stringify({ query: 'query($id:ID!,$row:ID!){table(id:$id){row(id:$row){files{url}}}}', variables: { id: tableId, row: rowId } }) });
  assert((await proxied.json()).data.table.row.files[0].url.startsWith("https://fixture.test/"), "proxy HTTP must not create mixed-content URLs");
  const image = await app.request(url); assert.equal(image.status, 200); assert.match(image.headers.get("Content-Disposition")!, /^inline/); assert.equal((await image.arrayBuffer()).byteLength, 4);
  assert.equal(image.headers.get("Access-Control-Allow-Origin"), "*"); assert.match(image.headers.get("Cache-Control")!, /no-store/);
  const forged = new URL(url); forged.pathname = forged.pathname.replace(rowId, randomUUID()); assert.equal((await app.request(forged.href)).status, 404);
  const noRead = new URL(url); noRead.searchParams.set("key", createKey); assert.equal((await app.request(noRead.href)).status, 403);
  await updateCells(deps, { rowId, organizationId: org, cells: { [fileColumnId]: [] } });
  try { assert.equal((await app.request(url)).status, 404); } finally { await updateCells(deps, { rowId, organizationId: org, cells: { [fileColumnId]: [fileId] } }); }
});

test("public CORS is cookie-free, errors are bounded, alias/fragment batches cannot multiply writes", async () => {
  const preflight = await app.request("https://fixture.test/api/graphql", { method: "OPTIONS", headers: { Origin: "https://landing.test", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-tabdo-key" } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "*"); assert.equal(preflight.headers.get("Access-Control-Allow-Credentials"), null);
  assert((await gql('{ tables { id } }', {}, personalKey)).body.errors);
  const over = await gql(`{ ${Array.from({ length: 21 }, (_, i) => `a${i}:tables{id}`).join(" ")} }`); assert.equal(over.body.errors[0].extensions.code, "QUERY_TOO_COMPLEX");
  const readGet = await app.request("https://fixture.test/api/graphql?query=" + encodeURIComponent("{tables{id}}"), { headers: { "X-Tabdo-Key": readKey } });
  assert.equal(readGet.status, 200);
  const getMutation = await app.request("https://fixture.test/api/graphql?query=" + encodeURIComponent(`mutation{createRow(tableId:"${tableId}",cells:{}){id}}`), { headers: { "X-Tabdo-Key": createKey } });
  assert.equal(getMutation.status, 405);
  const aliases = await gql('mutation($id:ID!){...A ...B} fragment A on Mutation {a:createRow(tableId:$id,cells:{}){id}} fragment B on Mutation {b:createRow(tableId:$id,cells:{}){id}}', { id: tableId }, createKey);
  assert(aliases.body.errors); assert(!aliases.body.data);
  limited = true; try { assert.equal((await gql('{tables{id}}')).response.status, 429); } finally { limited = false; }
  unavailable = true; try { assert.equal((await gql('{tables{id}}')).response.status, 503); } finally { unavailable = false; }
  const huge = await app.request("https://fixture.test/api/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Tabdo-Key": readKey }, body: JSON.stringify({ query: " ".repeat(140000) }) }); assert.equal(huge.status, 413);
  assert.equal(acquired, closed, "all public and management paths release their request scopes");
});

test("the real SDK queries GraphQL and creates through the same grants; edited and deleted grants apply immediately", async () => {
  const client = createClient({ url: "https://fixture.test", key: bothKey, fetch: async (input, init) => app.request(String(input), init) });
  assert.equal((await client.tables()).length, 1); assert((await client.table(tableId).columns()).length);
  const created = await client.table(tableId).create({ [titleId]: "SDK submission" }); assert.equal((await client.table(tableId).get(created.id))!.cells[titleId], "SDK submission");
  const page = await client.table(tableId).list({ limit: 1 }); assert.equal(page.rows.length, 1);
  await updateSiteKey(deps, actor, bothId, { name: "Changed", tableIds: [privateTableId], canRead: true, canCreate: false });
  await assert.rejects(client.table(tableId).list(), /Table not found/);
  assert.equal((await client.tables())[0].id, privateTableId);
  assert.equal((await manage('/'+bothId, undefined, "DELETE")).status, 200);
  await assert.rejects(client.tables(), /Invalid site API key/);
});


test("public resource startup and cleanup failures never leak internal errors or replace a committed response", async () => {
  const broken = new Hono().route("/api", createSiteApiRoutes(async () => { throw new Error("postgres://private-password@private-host/database"); }));
  const response = await broken.request("https://fixture.test/api/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "{tables{id}}" }) });
  assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /private-password|private-host/);
  const cleanup = new Hono().route("/api", createSiteApiRoutes(async request => ({ ...await acquire(request), logger: { error() { throw new Error("private-logger-password"); } }, close: async () => { throw new Error("private-cleanup-password"); } })));
  const saved = await cleanup.request("https://fixture.test/api/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Tabdo-Key": readKey }, body: JSON.stringify({ query: "{tables{id}}" }) });
  assert.equal(saved.status, 200); const result = await saved.json(); assert(!result.errors); assert(result.data.tables.length);
});
