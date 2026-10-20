import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID as id } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createClient } from "@tabdo/sdk";
import { EMPTY_DOCUMENT, COMMANDS, PLATFORM_TOOL_IDS, type DocumentContent, type TablePermission, type SiteViewConfig } from "@tabdo/shared";
import { createDatabase } from "../../src/business/db/factory.js";
import { organization, user, member, workspaces, tables, rows, columns, recordDocuments, recordDocumentLinks, userApiKeys, apiKeyDocuments, apiKeyBlogs } from "../../src/business/db/schema.js";
import * as commands from "../../src/business/commands/index.js";
import { createSiteKey, updateSiteKey, deleteSiteKey, resolveSiteKey, siteKeyInput } from "../../src/business/data-api/keys.js";
import { dispatchKeyCommand } from "../../src/business/data-api/commands.js";
import { siteCreateRow, siteUpdateRow } from "../../src/business/data-api/data.js";
import { createSiteApiRoutes, siteSchemaSDL } from "../../src/business/http/site-api.js";
import { createSiteAssetsRoute } from "../../src/business/http/sites.js";
import { createTableTools } from "../../src/business/agent/tools/index.js";
import { createMcpServer } from "../../src/mcp/tools.js";
import type { Actor } from "../../src/business/auth/actor.js";
import type { CommandDependencies } from "../../src/business/dependencies.js";
const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test")); assert.equal(url, process.env.DATABASE_URL_UNPOOLED);
const resource = createDatabase({ connectionString: url, poolMax: 8 });
const org = id(), uid = id(), mid = id();
let deps: CommandDependencies, tableId: string, titleId: string, otherTable: string, otherTitle: string;
const identity = { organizationId: org, actorId: uid };
const actor: Actor = { kind: "human", organizationId: org, userId: uid, memberId: mid, role: "owner", name: "Public author", email: `${uid}@test.local` };
const blobs = new Map<string, Uint8Array>(); let failStorage = false;
const storage = { async put(key: string, bytes: Uint8Array) { if (failStorage) throw new Error("offline"); blobs.set(key, bytes); }, async remove(key: string) { blobs.delete(key); }, async open(key: string) { const bytes = blobs.get(key); if (!bytes) throw new Error("missing"); return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }); } };
const content = (text: string): DocumentContent => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const grant = (bits: Partial<TablePermission> = {}): TablePermission => ({ tableId, canRead: false, canCreate: false, canUpdate: false, canDelete: false, ...bits });
const key = (bits: Partial<TablePermission>) => createSiteKey(deps, actor, { name: "Fixture", permissions: [grant(bits)] });
const acquire = async () => ({ commands: deps, identity: { database: deps.database, resolveSession: async () => null }, siteRateLimit: async () => {}, async close() {} });
const app = new Hono().route("/api", createSiteApiRoutes(acquire)).route("/", createSiteAssetsRoute(acquire));
const sdk = (secret: string) => createClient({ url: "http://fixture.test", key: secret, fetch: async (input, init) => app.request(String(input), init) });
const call = async (secret: string, command: string, input: Record<string, unknown>) => dispatchKeyCommand(deps, { principal: await resolveSiteKey(deps.database, secret), secret, baseUrl: "http://fixture.test" }, { command, input });
before(async () => {
  await resource.db.insert(organization).values({ id: org, name: "Unified", slug: org });
  await resource.db.insert(user).values({ id: uid, name: "Public author", email: actor.email });
  await resource.db.insert(member).values({ id: mid, organizationId: org, userId: uid, role: "owner" });
  const [workspace] = await resource.db.select().from(workspaces).where(eq(workspaces.organizationId, org));
  deps = { database: resource.db, workspaceId: workspace.id, uuid: id, now: () => new Date(), automationQueueName: "unused", afterRollback: resource.afterRollback, afterCommit: resource.afterCommit, sites: { storageDriver: "local", storage: () => storage, sdkUrl: "http://fixture.test/sdk.js", apiOrigin: "http://fixture.test", appOrigin: "http://fixture.test", publicOrigin: "http://fixture.test" } };
  actor.workspaceId = workspace.id;
  const table = await commands.createTable(deps, { organizationId: org, name: "An ordinary table" }); tableId = table.id;
  titleId = (await resource.db.select().from(columns).where(eq(columns.tableId, tableId)))[0].id;
  const other = await commands.createTable(deps, { organizationId: org, name: "Private table" }); otherTable = other.id;
  otherTitle = (await resource.db.select().from(columns).where(eq(columns.tableId, otherTable)))[0].id;
  await commands.createGridView(deps, { tableId, ...identity });
});
after(async () => { await resource.db.delete(organization).where(eq(organization.id, org)); await resource.db.delete(user).where(eq(user.id, uid)); await resource.close(); });

test("old/new ordinary rows have side-effect-free logical empty bodies; first save CAS, retry, mixed rollback", async () => {
  const [old] = await resource.db.insert(rows).values({ tableId }).returning();
  const beforeCount = (await resource.db.select().from(recordDocuments).where(eq(recordDocuments.organizationId, org))).length;
  for (let n = 0; n < 2; n++) {
    const loaded = await commands.getRow(deps, { rowId: old.id, includeBody: true, ...identity });
    assert.deepEqual(loaded.body!.content, EMPTY_DOCUMENT); assert.equal(loaded.body!.version, 0);
  }
  assert.equal((await resource.db.select().from(recordDocuments).where(eq(recordDocuments.organizationId, org))).length, beforeCount);
  assert(!("body" in await commands.getRow(deps, { rowId: old.id, ...identity })));
  const input = { rowId: old.id, body: { content: content("First"), expectedVersion: 0 }, idempotencyKey: id(), ...identity };
  const saves = await Promise.all([commands.updateCells(deps, input), commands.updateCells(deps, input)]);
  assert.equal(saves[0].bodyVersion, 1); assert.equal(saves[1].bodyVersion, 1); assert.equal(saves[0].version, 1);
  await assert.rejects(commands.updateCells(deps, { ...input, idempotencyKey: id() }), /Body changed/);
  await assert.rejects(commands.updateCells(deps, { ...input, body: { ...input.body, content: content("different") } }), /Idempotency/);
  await assert.rejects(commands.updateCells(deps, { rowId: old.id, cells: { [titleId]: "Must roll back" }, body: { content: content("wrong CAS"), expectedVersion: 0 }, idempotencyKey: id(), ...identity }));
  assert.equal((await commands.getRow(deps, { rowId: old.id, ...identity })).cells[titleId] ?? null, null);
  const races = await Promise.allSettled(["A", "B"].map(text => commands.updateCells(deps, { rowId: old.id, body: { content: content(text), expectedVersion: 1 }, idempotencyKey: id(), ...identity })));
  assert.equal(races.filter(result => result.status === "fulfilled").length, 1);
  for (let n = 0; n < 3; n++) {
    const both = await commands.addRow(deps, { tableId, ...identity });
    await Promise.all([
      commands.updateCells(deps, { rowId: both.id, cells: { [titleId]: "Concurrent properties" }, expectedVersion: 1, ...identity }),
      commands.updateCells(deps, { rowId: both.id, body: { content: content("Independent body"), expectedVersion: 0 }, idempotencyKey: id(), ...identity }),
    ]);
    const current = await commands.getRow(deps, { rowId: both.id, includeBody: true, ...identity });
    assert.equal(current.version, 2); assert.equal(current.body!.version, 1); assert.equal(current.cells[titleId], "Concurrent properties");
  }
  const [fresh] = await resource.db.insert(rows).values({ tableId }).returning();
  await resource.db.transaction(async tx => {
    await assert.rejects(commands.updateCells(deps, { rowId: fresh.id, cells: { [titleId]: "No partial data" }, body: { content: content("invalid"), expectedVersion: 7 }, idempotencyKey: id(), ...identity }, tx));
    assert.equal((await commands.getRow(deps, { rowId: fresh.id, includeBody: true, ...identity }, tx)).body!.version, 0);
  });
  const created = await commands.addRow(deps, { tableId, cells: { [titleId]: "Both" }, body: { content: content("Body") }, idempotencyKey: id(), ...identity });
  assert.equal(created.bodyVersion, 1); assert.equal((await commands.getRow(deps, { rowId: created.id, includeBody: true, ...identity })).body!.version, 1);
  assert(!("body" in (await commands.queryRows(deps, { tableId, ...identity })).rows[0]));
});

test("body-only writes touch record metadata and refresh scopes without advancing cell CAS; retries/failures do not touch it", async () => {
  const earlier = new Date("2020-01-01T00:00:00Z"), savedAt = new Date("2020-01-02T00:00:00Z");
  const [row] = await resource.db.insert(rows).values({ tableId, updatedAt: earlier }).returning();
  const clocked = { ...deps, now: () => savedAt };
  const input = { rowId: row.id, body: { content: content("Body is a record field"), expectedVersion: 0 }, idempotencyKey: id(), ...identity };
  const saved = await commands.updateCells(clocked, input);
  assert.equal(new Date(saved.updatedAt).getTime(), savedAt.getTime());
  assert.equal(saved.version, row.version); assert.equal(saved.bodyVersion, 1);
  assert(saved.affectedTableIds.includes(tableId));
  const later = { ...deps, now: () => new Date("2020-01-03T00:00:00Z") };
  const replay = await commands.updateCells(later, input);
  assert.equal(new Date(replay.updatedAt).getTime(), savedAt.getTime());
  await assert.rejects(commands.updateCells(later, { ...input, cells: { [titleId]: "Rollback" }, idempotencyKey: id() }), /Body changed/);
  await assert.rejects(resource.db.transaction(async tx => {
    await commands.updateCells(later, { ...input, body: { ...input.body, expectedVersion: 1 }, idempotencyKey: id() }, tx);
    throw new Error("late failure");
  }), /late failure/);
  const current = await commands.getRow(deps, { rowId: row.id, includeBody: true, ...identity });
  assert.equal(new Date(current.updatedAt).getTime(), savedAt.getTime());
  assert.equal(current.version, row.version); assert.equal(current.body!.version, 1);
  assert.equal(current.cells[titleId] ?? null, null);
});

test("original CRUD alone controls body/attachment/view operations; receipts never leak content and revocation is live", async () => {
  const creator = await key({ canCreate: true });
  const added = await sdk(creator.secret).table(tableId).create({ [titleId]: "Private" }, { body: { content: content("secret") }, idempotencyKey: id() });
  assert(!JSON.stringify(added).includes("secret")); assert(!("cells" in added));
  await assert.rejects(sdk(creator.secret).table(tableId).get(added.id, { includeBody: true }));
  const update = await key({ canUpdate: true });
  const [blank] = await resource.db.insert(rows).values({ tableId }).returning();
  const write = { rowId: blank.id, body: { content: content("write only"), expectedVersion: 0 }, idempotencyKey: id() };
  const receipt = (await call(update.secret, "updateCells", write)).result as Record<string, unknown>;
  assert.equal(receipt.bodyVersion, 1); assert(!("body" in receipt)); assert(!("cells" in receipt));
  const onlyRead = await key({ canRead: true });
  assert.equal((await sdk(onlyRead.secret).table(tableId).get(blank.id, { includeBody: true }))!.body!.version, 1);
  await assert.rejects(call(onlyRead.secret, "updateCells", write));
  await assert.rejects(call(update.secret, "getRow", { rowId: blank.id, includeBody: true }));
  await assert.rejects(call(update.secret, "createView", { tableId, type: "site", name: "Denied", config: { template: "blog", mapping: { title: titleId }, authorName: "Public", description: "", language: "en", articles: [] }, idempotencyKey: id() }));
  await updateSiteKey(deps, actor, update.key.id, { name: "shrunk", permissions: [grant({ canRead: true })] });
  await assert.rejects(call(update.secret, "updateCells", write));
  await deleteSiteKey(deps, actor, update.key.id); await assert.rejects(call(update.secret, "updateCells", write), /Invalid API key/);
  const foreign = await commands.addRow(deps, { tableId: otherTable, ...identity });
  await assert.rejects(call(onlyRead.secret, "getRow", { rowId: foreign.id, includeBody: true }));
  assert(!siteKeyInput.safeParse({ name: "retired", permissions: [], documentPermissions: [{ tableId, canRead: true }] }).success);
  // Seed old family-only rows without granting any canonical table bits.
  const legacy = await createSiteKey(deps, actor, { name: "old", permissions: [grant({ canRead: true })] });
  const { apiKeyTables } = await import("../../src/business/db/schema.js");
  await resource.db.delete(apiKeyTables).where(eq(apiKeyTables.keyId, legacy.key.id));
  await resource.db.insert(apiKeyDocuments).values({ keyId: legacy.key.id, tableId, canRead: true, canUpdate: true });
  await resource.db.insert(apiKeyBlogs).values({ keyId: legacy.key.id, tableId, canRead: true, canPublish: true, canBuild: true });
  await assert.rejects(call(legacy.secret, "getRow", { rowId: blank.id, includeBody: true }));
  await assert.rejects(call(legacy.secret, "updateCells", write));
  await assert.rejects(call(legacy.secret, "listViews", { tableId }));
});

test("HTTP Key writes cannot smuggle unvalidated cells; create/update options cannot override scoped inputs", async () => {
  const relation = await commands.addColumn(deps, { tableId, name: "Private link", type: "relation", config: { relation: { targetTableId: otherTable, inverseName: "Backlink" } }, ...identity });
  const inverse = (await commands.getTable(deps, { tableId: otherTable, ...identity })).columns.find(col => col.type === "relation")!;
  const a = await commands.addRow(deps, { tableId, ...identity });
  const b = await commands.addRow(deps, { tableId: otherTable, ...identity });
  const writer = await key({ canUpdate: true });
  const context = { principal: await resolveSiteKey(deps.database, writer.secret), secret: writer.secret, baseUrl: "http://fixture.test" };
  assert.equal(context.principal.permissions.get(tableId)!.canRead, false);
  assert(!context.principal.tableIds.has(otherTable));
  const http = (command: string, input: Record<string, unknown>) => app.request("/api/commands", { method: "POST", headers: { Authorization: `Bearer ${writer.secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ command, input }) });
  assert.equal((await http("updateCells", { rowId: a.id, cells: { [relation.id]: [b.id] } })).status, 400);
  const response = await http("updateCell", { rowId: a.id, columnId: titleId, value: "Validated text", cells: { [relation.id]: [b.id] } });
  assert.equal(response.status, 200);
  assert(!("cells" in (await response.json()).result));
  const source = await commands.getRow(deps, { rowId: a.id, ...identity });
  assert.equal(source.cells[titleId], "Validated text"); assert.deepEqual(source.cells[relation.id], []);

  // Defense at the data boundary too: no transport/caller can override validated cells or ownership.
  const creator = await key({ canCreate: true });
  const createContext = { ...context, secret: creator.secret, principal: await resolveSiteKey(deps.database, creator.secret) };
  const injected = { tableId: otherTable, rowId: b.id, cells: { [relation.id]: [b.id] }, expectedVersion: 999, actorId: uid, skipAutomation: true };
  const createInput = { ...injected, body: { content: content("Allowed create body") }, idempotencyKey: id() };
  const created = await siteCreateRow(deps, createContext, tableId, { [titleId]: "Allowed create cells" }, createInput);
  assert.deepEqual(await siteCreateRow(deps, createContext, tableId, { [titleId]: "Allowed create cells" }, createInput), created);
  const loaded = await commands.getRow(deps, { rowId: created.id, includeBody: true, ...identity });
  assert.equal(loaded.tableId, tableId); assert.equal(loaded.cells[titleId], "Allowed create cells");
  assert.deepEqual(loaded.cells[relation.id], []); assert.equal(loaded.body!.version, 1);
  const updateInput = { ...injected, body: { content: content("Allowed update body"), expectedVersion: 1 }, idempotencyKey: id() };
  const changed = await siteUpdateRow(deps, context, tableId, created.id, { [titleId]: "Allowed update cells" }, loaded.version, updateInput);
  assert.deepEqual(await siteUpdateRow(deps, context, tableId, created.id, { [titleId]: "Allowed update cells" }, loaded.version, updateInput), changed);
  const updated = await commands.getRow(deps, { rowId: created.id, includeBody: true, ...identity });
  assert.equal(updated.cells[titleId], "Allowed update cells"); assert.equal(updated.body!.version, 2);
  assert.deepEqual(updated.cells[relation.id], []);
  const privateRow = await commands.getRow(deps, { rowId: b.id, ...identity });
  assert.equal(privateRow.version, b.version); assert.deepEqual(privateRow.cells[inverse.id], []);
  assert.equal(privateRow.cells[otherTitle] ?? null, null);
  // The whitelist also validates its allowed fields at the HTTP boundary, before any write.
  assert.equal((await http("addRow", { tableId, cells: {}, body: { content: content("invalid") }, idempotencyKey: 123 })).status, 400);
  assert.equal((await http("updateCells", { rowId: a.id, cells: {}, body: { content: content("invalid"), expectedVersion: "0" }, idempotencyKey: id() })).status, 400);
  const unchanged = await commands.getRow(deps, { rowId: a.id, includeBody: true, ...identity });
  assert.equal(unchanged.version, source.version); assert.equal(unchanged.body!.version, 0);
});

test("row-owned images lazily allocate body under Update, reject foreign references and clean failed uploads", async () => {
  const editor = await key({ canRead: true, canUpdate: true }), client = sdk(editor.secret).table(tableId);
  const [row, peer] = await resource.db.insert(rows).values([{ tableId }, { tableId }]).returning();
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVQIHWP4DwABAQEAG7buVgAAAABJRU5ErkJggg==";
  const uploadKey = id();
  const file = await client.uploadAttachment(row.id, { target: "body", expectedVersion: 0, name: "owned.png", mimeType: "image/png", base64: png, idempotencyKey: uploadKey });
  assert.equal(file.bodyVersion, 1); assert.equal((await client.getAttachment(row.id, file.fileId)).base64, png);
  await assert.rejects(client.getAttachment(peer.id, file.fileId));
  await assert.rejects(client.update(peer.id, {}, { body: { content: { type: "doc", content: [{ type: "image", attrs: { fileId: file.fileId, alt: "Owned" } }] }, expectedVersion: 0 }, idempotencyKey: id() }));
  const imageContent: DocumentContent = { type: "doc", content: [{ type: "image", attrs: { fileId: file.fileId, alt: "Owned" } }] };
  await client.update(row.id, {}, { body: { content: imageContent, expectedVersion: 1 }, idempotencyKey: id() });
  assert.equal((await client.get(row.id, { includeBody: true }))!.body!.attachments[0].fileId, file.fileId);
  const replay = await client.uploadAttachment(row.id, { target: "body", expectedVersion: 0, name: "owned.png", mimeType: "image/png", base64: png, idempotencyKey: uploadKey });
  assert.equal(replay.bodyVersion, 1, "upload retries retain their original body CAS, never adopt a concurrent body's version");
  const before = blobs.size; failStorage = true;
  try { await assert.rejects(client.uploadAttachment(peer.id, { target: "body", expectedVersion: 0, name: "failed.png", mimeType: "image/png", base64: png, idempotencyKey: id() })); } finally { failStorage = false; }
  assert.equal(blobs.size, before); assert.equal((await client.get(peer.id, { includeBody: true }))!.body!.version, 0);
});

test("any table site view explicitly publishes snapshots; source edits stay private and withdrawal preserves other copies", async () => {
  const editor = await key({ canRead: true, canUpdate: true, canDelete: true }), client = sdk(editor.secret).table(tableId);
  const a = await commands.addRow(deps, { tableId, cells: { [titleId]: "First" }, body: { content: content("First public") }, idempotencyKey: id(), ...identity });
  const b = await commands.addRow(deps, { tableId, cells: { [titleId]: "Second" }, ...identity });
  const config: SiteViewConfig = { template: "blog", mapping: { title: titleId }, authorName: "Public", description: "", language: "en", articles: [a, b].map(row => ({ rowId: row.id, imageIds: [] })) };
  const view = await client.createView({ type: "site", name: "Ordinary table site", config, idempotencyKey: id() });
  assert.equal(view.tableId, tableId); assert.equal(view.site!.publishedRevisionId, null);
  assert.equal((await app.request(view.site!.publicUrl)).status, 404);
  await assert.rejects(client.view(view.id).update({ config: { ...config, mapping: { title: otherTitle } }, expectedVersion: view.site!.version, idempotencyKey: id() }));
  const published = await client.view(view.id).update({ expectedVersion: view.site!.version, publication: { action: "publish", expectedPublishedRevisionId: null }, idempotencyKey: id() });
  const page = async (url: string): Promise<Response> => { const response = await app.request(url); return response.status === 302 ? app.request(response.headers.get("Location")!) : response; };
  const online = await page(`${published.site!.publicUrl}articles/${b.id}.html`), oldHtml = await online.text();
  assert.equal(online.status, 200); assert(!online.headers.get("content-security-policy")?.includes("script-src 'self'"));
  assert(oldHtml.includes("Second"));
  await commands.updateCells(deps, { rowId: b.id, cells: { [titleId]: "Unrelated draft" }, ...identity });
  assert.equal(await (await page(`${published.site!.publicUrl}articles/${b.id}.html`)).text(), oldHtml);
  await assert.rejects(commands.deleteRow(deps, { rowId: a.id, ...identity }));
  const withdrawn = await client.view(view.id).update({ expectedVersion: published.site!.version, publication: { action: "withdraw", expectedPublishedRevisionId: published.site!.publishedRevisionId!, rowId: a.id }, idempotencyKey: id() });
  assert.equal(await (await page(`${published.site!.publicUrl}articles/${b.id}.html`)).text(), oldHtml);
  assert.equal((await page(`${published.site!.publicUrl}articles/${a.id}.html`)).status, 404);
  await commands.deleteRow(deps, { rowId: a.id, ...identity });
  const draft = await client.view(view.id).update({ name: "Draft settings", expectedVersion: withdrawn.site!.version, idempotencyKey: id() });
  assert.equal(draft.site!.publishedRevisionId, withdrawn.site!.publishedRevisionId);
  const unpublish = { expectedVersion: draft.site!.version, publication: { action: "unpublish" as const, expectedPublishedRevisionId: draft.site!.publishedRevisionId }, idempotencyKey: id() };
  await client.view(view.id).update(unpublish); await client.view(view.id).update(unpublish);
  assert.equal((await app.request(view.site!.publicUrl)).status, 404);
  await client.view(view.id).delete();
});

test("explicit publication failures roll back new artifacts, blobs and receipts; no-Read Delete can delete an unpublished view", async () => {
  const row = await commands.addRow(deps, { tableId, cells: { [titleId]: "Failure fixture" }, ...identity });
  const view = await commands.createView(deps, { tableId, type: "site", name: "Atomic publication", config: { template: "blog", authorName: "Public", description: "", language: "en", mapping: { title: titleId }, articles: [{ rowId: row.id, imageIds: [] }] }, idempotencyKey: id(), ...identity });
  const input = { viewId: view.id, expectedVersion: view.site!.version, idempotencyKey: id(), publication: { action: "publish" as const, expectedPublishedRevisionId: null }, ...identity };
  const before = blobs.size; let writes = 0;
  const broken: CommandDependencies = { ...deps, sites: { ...deps.sites!, storage: () => ({ ...storage, async put(key, bytes) { if (++writes === 2) throw new Error("partial upload failure"); return storage.put(key, bytes); } }) } };
  await assert.rejects(commands.updateView(broken, input));
  assert.equal(blobs.size, before);
  const failed = await commands.getView(deps, { viewId: view.id, ...identity });
  assert.equal(failed.site!.publishedRevisionId, null); assert.equal(failed.site!.version, view.site!.version);
  const published = await commands.updateView(deps, input);
  const publishedBlobs = blobs.size;
  await assert.rejects(resource.db.transaction(async tx => {
    await commands.updateView(deps, { ...input, expectedVersion: published.site!.version, publication: { action: "publish", expectedPublishedRevisionId: published.site!.publishedRevisionId }, idempotencyKey: id() }, tx);
    throw new Error("late host failure");
  }), /late host failure/);
  assert.equal(blobs.size, publishedBlobs);
  assert.equal((await commands.getView(deps, { viewId: view.id, ...identity })).site!.publishedRevisionId, published.site!.publishedRevisionId);
  await commands.updateView(deps, { viewId: view.id, expectedVersion: published.site!.version, publication: { action: "unpublish", expectedPublishedRevisionId: published.site!.publishedRevisionId }, idempotencyKey: id(), ...identity });
  const deleter = await key({ canDelete: true });
  assert.deepEqual((await call(deleter.secret, "deleteView", { viewId: view.id })).result, { ok: true });
});

test("REST/GraphQL/SDK/native/MCP catalogs use canonical rows/views, reject retired families", async () => {
  const editor = await key({ canRead: true, canCreate: true, canUpdate: true });
  const headers = { Authorization: `Bearer ${editor.secret}`, "Content-Type": "application/json" };
  const created = await app.request(`/api/tables/${tableId}/rows`, { method: "POST", headers, body: JSON.stringify({ cells: {}, body: { content: content("via REST") }, idempotencyKey: id() }) });
  assert.equal(created.status, 201); const row = await created.json();
  const read = await app.request(`/api/tables/${tableId}/rows/${row.id}?include=body&bodyFormat=html`, { headers });
  assert((await read.json()).body.html.includes("via REST"));
  const list = await sdk(editor.secret).table(tableId).list(); assert(list.rows.every(row => !("body" in row)));
  assert.equal((await app.request(`/api/tables/${tableId}/rows/${row.id}/document`, { headers })).status, 410);
  assert.equal((await app.request("/api/commands", { method: "POST", headers, body: JSON.stringify({ command: "getDocument", input: { tableId, rowId: row.id } }) })).status, 410);
  assert(!("documents" in sdk(editor.secret))); assert(!("blogs" in sdk(editor.secret)));
  for (const name of ["getDocument", "createDocument", "replaceDocument", "getBlog", "publishBlog", "authorizeBlogPublication"]) { assert(!(COMMANDS as readonly string[]).includes(name)); assert(!siteSchemaSDL.includes(`${name}(`)); }
  const native = createTableTools(deps, tableId, org, uid);
  for (const name of ["get_row", "create_view", "update_view", "upload_row_attachment", "get_row_attachment"]) assert(native[name]);
  for (const name of ["get_document", "create_document", "replace_document", "get_blog", "publish_blog"]) { assert(!native[name]); assert(!(PLATFORM_TOOL_IDS as readonly string[]).includes(name)); }
  const [transport, remote] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(async (command, input) => call(editor.secret, command, input));
  const client = new Client({ name: "Unified test", version: "1" });
  try {
    await Promise.all([server.connect(transport), client.connect(remote)]);
    const catalog = (await client.listTools()).tools;
    assert(catalog.some(tool => tool.name === "create_view")); assert(!catalog.some(tool => tool.name === "get_document"));
    const response = await client.callTool({ name: "get_row", arguments: { rowId: row.id, includeBody: true } });
    assert(JSON.stringify(response).includes("via REST"));
  } finally { await client.close(); await server.close(); }
});
