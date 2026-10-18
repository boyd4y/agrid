import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase } from "../../src/business/db/factory.js";
import { organization, user, member, workspaces, tables, rows, recordDocuments, recordDocumentLinks, documentRevisions, documentReceipts, documentImages } from "../../src/business/db/schema.js";
import { executeDocument, type DocumentCaller } from "../../src/business/documents/service.js";
import { DocumentError } from "../../src/business/documents/errors.js";
import { renderDocumentHtml } from "../../src/business/documents/renderer.js";
import { createSiteKey, updateSiteKey, deleteSiteKey } from "../../src/business/data-api/keys.js";
import { createDocumentTools } from "../../src/business/agent/tools/documents.js";
import { nativeHostTools } from "../../src/harness/tools.js";
import { getToolTransaction } from "../../src/ai/execution-context.js";
import { createSiteApiRoutes } from "../../src/business/http/site-api.js";
import { createCommandsRoute } from "../../src/business/http/commands.js";
import { createClient } from "@tabdo/sdk";
import type { CommandDependencies } from "../../src/business/dependencies.js";
import type { Actor } from "../../src/business/auth/actor.js";
import { EMPTY_DOCUMENT, type DocumentCommand, type DocumentCommands, type DocumentPermission, type DocumentContent } from "@tabdo/shared";
const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test")); assert.equal(process.env.DATABASE_URL_UNPOOLED, url);
const resource = createDatabase({ connectionString: url, poolMax: 8 }), other = createDatabase({ connectionString: url, poolMax: 4 });
const k = randomUUID, org = k(), uid = k(), mid = k(), agent = k();
const blobs = new Map<string, Uint8Array>();
const storage = { async put(key: string, bytes: Uint8Array) { blobs.set(key, bytes); }, async open(key: string) { const bytes = blobs.get(key); if (!bytes) throw new Error("missing"); return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }); }, async remove(key: string) { blobs.delete(key); } };
const depsFor = (r: typeof resource): CommandDependencies => ({ database: r.db, uuid: k, now: () => new Date(), automationQueueName: "unused", afterRollback: r.afterRollback, sites: { storageDriver: "local", storage: () => storage, sdkUrl: "https://example.test/sdk.js", apiOrigin: "http://local.test", appOrigin: "http://local.test", publicOrigin: "http://local.test" } });
let a: CommandDependencies, b: CommandDependencies, tableId: string, rowId: string;
const caller: DocumentCaller = { kind: "member", organizationId: org, actorId: uid };
const actor: Actor = { kind: "human", organizationId: org, userId: uid, memberId: mid, role: "owner", name: "Document test", email: `${uid}@local.test` };
const identity = () => ({ tableId, rowId });
const call = <K extends DocumentCommand>(command: K, input: DocumentCommands[K], bound = a, who: DocumentCaller = caller) => executeDocument(bound, who, command, input);
const body = (text: string): DocumentContent => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const code = (expected: string) => (error: unknown) => error instanceof DocumentError && error.code === expected;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVQIHWP4DwABAQEAG7buVgAAAABJRU5ErkJggg==";
const grant = (overrides: Partial<DocumentPermission> = {}): DocumentPermission => ({ tableId, canRead: false, canCreate: false, canUpdate: false, canReadHistory: false, canRestore: false, canUpload: false, ...overrides });
const revisionRows = () => resource.db.select({ revision: documentRevisions }).from(documentRevisions).innerJoin(recordDocuments, eq(recordDocuments.id, documentRevisions.documentId)).where(eq(recordDocuments.organizationId, org));
before(async () => {
  await resource.db.insert(organization).values({ id: org, name: "Document fixture", slug: org });
  await resource.db.insert(user).values([{ id: uid, name: "Owner", email: actor.email }, { id: agent, kind: "agent", name: "Agent", email: `${agent}@local.test` }]);
  await resource.db.insert(member).values([{ id: mid, organizationId: org, userId: uid, role: "owner" }, { id: k(), organizationId: org, userId: agent, role: "member" }]);
  const [workspace] = await resource.db.select().from(workspaces).where(eq(workspaces.organizationId, org));
  a = { ...depsFor(resource), workspaceId: workspace.id }; b = { ...depsFor(other), workspaceId: workspace.id }; actor.workspaceId = workspace.id;
  const [table] = await resource.db.insert(tables).values({ organizationId: org, workspaceId: workspace.id, name: "Articles" }).returning(); tableId = table.id;
  const [row] = await resource.db.insert(rows).values({ tableId }).returning(); rowId = row.id;
});
after(async () => { await resource.db.delete(organization).where(eq(organization.id, org)); await resource.db.delete(user).where(eq(user.id, uid)); await resource.db.delete(user).where(eq(user.id, agent)); await other.close(); await resource.close(); });
test("independent clients keep only current content with CAS/idempotency, preserving existing historical data and row metadata", async () => {
  assert.equal(await call("getDocument", identity()), null);
  const input = { ...identity(), content: body("中文正文"), idempotencyKey: k() };
  const created = await Promise.all([call("createDocument", input), call("createDocument", input, b)]); assert.deepEqual(created[0], created[1]);
  assert(!("content" in created[0]));
  const races = await Promise.allSettled([call("replaceDocument", { ...identity(), content: body("a"), expectedVersion: 1, idempotencyKey: k() }), call("replaceDocument", { ...identity(), content: body("b"), expectedVersion: 1, idempotencyKey: k() }, b)]);
  assert.equal(races.filter(x => x.status === "fulfilled").length, 1); assert(code("VERSION_CONFLICT")((races.find(x => x.status === "rejected") as PromiseRejectedResult).reason));
  await assert.rejects(call("createDocument", { ...input, content: body("changed") }), code("IDEMPOTENCY_MISMATCH"));
  assert.deepEqual(await revisionRows(), [], "create and replacement do not append revisions");
  const current = (await call("getDocument", identity()))!;
  // Retained legacy data is neither consulted nor changed by later ordinary saves.
  await resource.db.insert(documentRevisions).values({ documentId: current.id, version: 1, content: input.content });
  const legacy = await revisionRows();
  const write = { ...identity(), expectedVersion: current.version, content: body("only current content"), idempotencyKey: k() };
  const updated = await call("replaceDocument", write);
  assert.equal(updated.version, current.version + 1);
  assert.deepEqual((await call("getDocument", identity()))!.content, write.content);
  assert.deepEqual(await revisionRows(), legacy);
  const [row] = await resource.db.select().from(rows).where(eq(rows.id, rowId)); assert.equal(row.version, 1); assert.deepEqual(row.cells, {});
});
test("late host failure and handled native errors roll back changes, history, receipts and uploaded blobs", async () => {
  const current = (await call("getDocument", identity()))!;
  const write = { ...identity(), expectedVersion: current.version, content: current.content, idempotencyKey: k() };
  const replayed = await Promise.all([call("replaceDocument", write), call("replaceDocument", write, b)]); assert.deepEqual(replayed[0], replayed[1]);
  current.version++;
  const beforeRevs = await revisionRows(), beforeBlobs = blobs.size;
  await assert.rejects(resource.db.transaction(async tx => {
    await executeDocument(a, caller, "replaceDocument", { ...identity(), expectedVersion: current.version, content: body("must roll back"), idempotencyKey: k() }, tx);
    await executeDocument(a, caller, "uploadDocumentImage", { ...identity(), expectedVersion: current.version + 1, name: "late.png", mimeType: "image/png", base64: png, idempotencyKey: k() }, tx);
    throw new Error("late outer failure");
  }), /late outer failure/);
  assert.equal(blobs.size, beforeBlobs); assert.deepEqual(await revisionRows(), beforeRevs); assert.deepEqual((await call("getDocument", identity()))!.content, current.content);
  await resource.db.transaction(async outer => {
    await assert.rejects(outer.transaction(async nested => { await executeDocument(a, caller, "uploadDocumentImage", { ...identity(), expectedVersion: current.version, name: "nested.png", mimeType: "image/png", base64: png, idempotencyKey: k() }, nested); throw new Error("nested rollback"); }), /nested rollback/);
    await outer.execute(sql`select 1`);
  });
  assert.equal(blobs.size, beforeBlobs);
  const tools = nativeHostTools(createDocumentTools(a, org, uid, getToolTransaction), operation => resource.db.transaction(tx => operation(tx)), { userId: uid, organizationId: org }).tools;
  const result = await tools.replace_document.execute!({ ...identity(), expectedVersion: current.version, content: body("native write"), idempotencyKey: k() }, { toolCallId: k(), messages: [], context: {} }); assert.equal((result as any).version, current.version + 1);
  const count = (await resource.db.select().from(documentReceipts).where(eq(documentReceipts.workspaceId, a.workspaceId!))).length;
  await resource.db.transaction(async tx => {
    const broken = createDocumentTools(a, org, uid, tx);
    const result = await broken.replace_document.execute!({ ...identity(), expectedVersion: 999, content: body("bad"), idempotencyKey: k() }, { toolCallId: k(), messages: [], context: {} }); assert.equal((result as any).ok, false);
    await tx.execute(sql`select 1`);
  });
  assert.equal((await resource.db.select().from(documentReceipts).where(eq(documentReceipts.workspaceId, a.workspaceId!))).length, count);
  assert.deepEqual((await tools.get_document.execute!(identity(), { toolCallId: k(), messages: [], context: {} }) as any).content, body("native write"));
});
test("private images have scoped ownership, shared budgets and safe static rendering", async () => {
  const doc = (await call("getDocument", identity()))!;
  const uploaded = await call("uploadDocumentImage", { ...identity(), expectedVersion: doc.version, name: "image.png", mimeType: "image/png", base64: png, idempotencyKey: k() });
  assert.equal((await call("getDocumentImage", { ...identity(), fileId: uploaded.fileId })).base64, png);
  const content: DocumentContent = { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "<script>alert(1)</script>" }] }, { type: "paragraph", content: [{ type: "text", text: "safe", marks: [{ type: "link", attrs: { href: "https://example.com/?a=1&b=2" } }] }] }, { type: "image", attrs: { fileId: uploaded.fileId, alt: '\" onerror=alert(1)' } }] };
  await call("replaceDocument", { ...identity(), expectedVersion: doc.version, content, idempotencyKey: k() });
  const rendered = await call("renderDocument", identity()); assert.equal(rendered.assets[0].fileId, uploaded.fileId); assert(rendered.html.includes("&lt;script&gt;")); assert(!rendered.html.includes("<script>")); assert(rendered.html.includes('alt="&quot; onerror=alert(1)"')); assert(!rendered.html.includes("tab_"));
  const forged = structuredClone(content); forged.content[2].attrs!.fileId = k();
  await assert.rejects(call("replaceDocument", { ...identity(), expectedVersion: doc.version + 1, content: forged, idempotencyKey: k() }), code("BAD_INPUT"));
  await assert.rejects(call("uploadDocumentImage", { ...identity(), expectedVersion: doc.version + 1, name: "evil.png", mimeType: "image/png", base64: btoa("<svg onload=alert(1)>"), idempotencyKey: k() }), code("BAD_INPUT"));
  assert.throws(() => renderDocumentHtml(body("a".repeat(100000))));
});
test("capabilities do not inherit table/calendar access, creation does not read, grant shrinking and revocation defeat old receipts", async () => {
  const tableKey = await createSiteKey(a, actor, { name: "Table only", permissions: [{ tableId, canRead: true, canCreate: true, canUpdate: true, canDelete: true }] });
  await assert.rejects(call("getDocument", identity(), a, { kind: "key", secret: tableKey.secret }), code("NOT_FOUND"));
  const { executeCalendar } = await import("../../src/business/calendar/service.js");
  const calendar = await executeCalendar(a, caller, "createCalendar", { name: "Availability only", timeZone: "Asia/Shanghai", idempotencyKey: k() });
  const availabilityKey = await createSiteKey(a, actor, { name: "Availability only", permissions: [], calendarPermissions: [{ calendarId: calendar.id, canRead: false, canReadAvailability: true, canCreate: false, canUpdate: false, canCancel: false, canManage: false }] });
  await assert.rejects(call("getDocument", identity(), a, { kind: "key", secret: availabilityKey.secret }), code("NOT_FOUND"));
  const row = (await resource.db.insert(rows).values({ tableId }).returning())[0];
  const key = await createSiteKey(a, actor, { name: "Create only", permissions: [], documentPermissions: [grant({ canCreate: true })] });
  const input = { tableId, rowId: row.id, content: EMPTY_DOCUMENT, idempotencyKey: k() };
  const accepted = await call("createDocument", input, a, { kind: "key", secret: key.secret }); assert(!("content" in accepted));
  await assert.rejects(call("getDocument", input as any, a, { kind: "key", secret: key.secret }), code("BAD_INPUT"));
  await assert.rejects(call("getDocument", { tableId, rowId: row.id }, a, { kind: "key", secret: key.secret }), code("FORBIDDEN"));
  await updateSiteKey(a, actor, key.key.id, { name: "Read only", permissions: [], documentPermissions: [grant({ canRead: true })] });
  await assert.rejects(call("createDocument", input, a, { kind: "key", secret: key.secret }), code("FORBIDDEN"));
  await deleteSiteKey(a, actor, key.key.id); await assert.rejects(call("createDocument", input, a, { kind: "key", secret: key.secret }), /Invalid API key/);
  await resource.db.delete(rows).where(eq(rows.id, row.id));
  assert.equal((await resource.db.select().from(recordDocuments).where(eq(recordDocuments.id, accepted.id))).length, 1);
  assert.equal((await resource.db.select().from(recordDocumentLinks).where(eq(recordDocumentLinks.documentId, accepted.id))).length, 0);
  await assert.rejects(call("getDocument", { tableId, rowId: row.id }), code("NOT_FOUND"));
});
test("cross workspace/table/row/organization cannot resolve through a document, including database FK bypass", async () => {
  const [workspace] = await resource.db.insert(workspaces).values({ organizationId: org, name: "Other", isDefault: false }).returning();
  const [table] = await resource.db.insert(tables).values({ organizationId: org, workspaceId: workspace.id, name: "Other" }).returning();
  const [row] = await resource.db.insert(rows).values({ tableId: table.id }).returning();
  await assert.rejects(call("getDocument", { tableId: table.id, rowId: row.id }), code("NOT_FOUND"));
  await assert.rejects(call("getDocument", { tableId, rowId: row.id }), code("NOT_FOUND"));
  await assert.rejects(call("getDocument", identity(), { ...a, workspaceId: workspace.id }), code("NOT_FOUND"));
  await assert.rejects(call("getDocument", identity(), a, { kind: "member", organizationId: k(), actorId: uid }), code("FORBIDDEN"));
  const doc = (await call("getDocument", identity()))!;
  await assert.rejects(resource.db.insert(recordDocumentLinks).values({ documentId: doc.id, tableId, rowId: row.id, workspaceId: a.workspaceId!, organizationId: org }));
});
test("REST, member commands, GraphQL and typed SDK execute the same core under live grants", async () => {
  const key = await createSiteKey(a, actor, { name: "Body API", permissions: [], documentPermissions: [grant({ canRead: true, canUpdate: true, canReadHistory: true })] });
  const acquire = async () => ({ commands: a, identity: { database: a.database, async resolveSession() { return null; } }, siteRateLimit: async () => {}, async close() {} });
  const api = createSiteApiRoutes(acquire);
  const { Hono } = await import("hono"); const host = new Hono().route("/api", api);
  const headers = { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" };
  const rest = await api.request(`/tables/${tableId}/rows/${rowId}/document`, { headers }); assert.equal(rest.status, 200); const current = await rest.json() as any;
  const sdk = createClient({ url: "http://local.test/api/graphql", key: key.secret, fetch: (async (input: RequestInfo | URL, init?: RequestInit) => host.request(new Request(input, init))) as typeof fetch });
  assert.deepEqual((await sdk.documents.getDocument(identity()))!.content, current.content);
  const saved = await sdk.documents.replaceDocument({ ...identity(), expectedVersion: current.version, content: body("SDK actual execution"), idempotencyKey: k() }); assert.equal(saved.version, current.version + 1);
  const html = await sdk.documents.renderDocument(identity()); assert(html.html.includes("SDK actual execution"));
  const uploadKey = await createSiteKey(a, actor, { name: "Image API", permissions: [], documentPermissions: [grant({ canUpload: true, canRead: true })] });
  const largePng = Buffer.concat([Buffer.from(png, "base64"), Buffer.alloc(150000)]).toString("base64");
  const uploadSdk = createClient({ url: "http://local.test", key: uploadKey.secret, fetch: (async (input: RequestInfo | URL, init?: RequestInit) => host.request(new Request(input, init))) as typeof fetch });
  const image = await uploadSdk.documents.uploadDocumentImage({ ...identity(), expectedVersion: saved.version, mimeType: "image/png", name: "large.png", base64: largePng, idempotencyKey: k() });
  assert.equal((await uploadSdk.documents.getDocumentImage({ ...identity(), fileId: image.fileId })).base64, largePng);
  const oversized = await host.request("/api/graphql", { method: "POST", headers, body: JSON.stringify({ query: "query { tables { id } }", variables: { padding: "x".repeat(150000) } }) }); assert.equal(oversized.status, 413);
  const unknown = await api.request(`/tables/${k()}/rows/${rowId}/document`, { headers }); assert.equal(unknown.status, 404);
  const bad = await api.request("/commands", { method: "POST", headers, body: JSON.stringify({ command: "replaceDocument", input: { ...identity(), expectedVersion: 999, content: EMPTY_DOCUMENT, idempotencyKey: k() } }) }); assert.equal(bad.status, 409); assert.equal((await bad.json() as any).code, "VERSION_CONFLICT");
  for (const command of ["listDocumentRevisions", "getDocumentRevision", "restoreDocumentRevision"]) {
    const unsupported = await api.request("/commands", { method: "POST", headers, body: JSON.stringify({ command, input: identity() }) });
    assert.equal(unsupported.status, 403, "removed key commands follow the standard unsupported path");
    const query = await host.request("/api/graphql", { method: "POST", headers, body: JSON.stringify({ query: `query($input: JSON!) { ${command}(input: $input) }`, variables: { input: identity() } }) });
    assert.equal(query.status, 200);
    const unsupportedGraphql = await query.json() as any;
    assert(unsupportedGraphql.errors.some((error: { message: string }) => error.message.includes("Cannot query field")));
    assert(!unsupportedGraphql.data);
    assert(!Object.hasOwn(sdk.documents, command));
  }
  for (const path of ["revisions", "revisions/1", "restore"]) {
    const unsupported = await api.request(`/tables/${tableId}/rows/${rowId}/document/${path}`, { method: path === "restore" ? "POST" : "GET", headers });
    assert.equal(unsupported.status, 404);
  }
  const oldRender = await api.request(`/tables/${tableId}/rows/${rowId}/document/render?version=1`, { headers }); assert.equal(oldRender.status, 400);
  const nativeTools = createDocumentTools(a, org, uid);
  for (const name of ["list_document_revisions", "get_document_revision", "restore_document_revision"]) assert(!Object.hasOwn(nativeTools, name));
  const inertKey = await createSiteKey(a, actor, { name: "Legacy inert history only", permissions: [], documentPermissions: [grant({ canReadHistory: true, canRestore: true })] });
  await assert.rejects(call("getDocument", identity(), a, { kind: "key", secret: inertKey.secret }), code("FORBIDDEN"));
  const memberApi = createCommandsRoute(async () => ({ commands: a, identity: { database: a.database, async resolveSession() { return { user: { id: uid, name: actor.name, email: actor.email }, session: { activeOrganizationId: org } } as any; } }, async close() {} }));
  const unsupportedMember = await memberApi.request("/", { method: "POST", headers: { "Content-Type": "application/json", "X-Workspace-Id": a.workspaceId! }, body: JSON.stringify({ command: "listDocumentRevisions", input: identity() }) }); assert.equal(unsupportedMember.status, 400);
  const result = await memberApi.request("/", { method: "POST", headers: { "Content-Type": "application/json", "X-Workspace-Id": a.workspaceId! }, body: JSON.stringify({ command: "getDocument", input: identity() }) }); assert.equal(result.status, 200);
});
test("a late image receipt SQL failure rolls back its savepoint and blob while the host commits other work", async () => {
  const doc = (await call("getDocument", identity()))!;
  const input = { ...identity(), expectedVersion: doc.version, name: "receipt-fault.png", mimeType: "image/png" as const, base64: png, idempotencyKey: k() };
  const functionName = `document_receipt_fault_${k().replaceAll("-", "")}`;
  const beforeBlobs = blobs.size, beforeHistory = await revisionRows();
  const hostRow = k();
  await resource.db.execute(sql.raw(`CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key = '${input.idempotencyKey}' THEN RAISE EXCEPTION 'late document receipt fault'; END IF; RETURN NEW; END; $$`));
  try {
    await resource.db.execute(sql.raw(`CREATE TRIGGER "${functionName}" BEFORE UPDATE OF result ON document_receipts FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`));
    await resource.db.transaction(async tx => {
      await assert.rejects(executeDocument(a, caller, "uploadDocumentImage", input, tx), error =>
        error instanceof Error && error.cause instanceof Error && error.cause.message === "late document receipt fault");
      assert.equal(blobs.size, beforeBlobs, "failed child upload is removed before the host commits");
      assert.equal((await tx.select().from(documentReceipts).where(eq(documentReceipts.key, input.idempotencyKey))).length, 0);
      await tx.insert(rows).values({ id: hostRow, tableId });
    });
    assert.equal((await other.db.select().from(rows).where(eq(rows.id, hostRow))).length, 1);
    assert.deepEqual(await revisionRows(), beforeHistory);
    assert.deepEqual(await call("getDocument", identity()), doc);
  } finally {
    await resource.db.execute(sql.raw(`DROP TRIGGER IF EXISTS "${functionName}" ON document_receipts`));
    await resource.db.execute(sql.raw(`DROP FUNCTION "${functionName}"()`));
  }
  const retried = await call("uploadDocumentImage", input);
  assert.equal((await call("getDocumentImage", { ...identity(), fileId: retried.fileId })).base64, png);
  assert.deepEqual(await call("uploadDocumentImage", input, b), retried);
  assert.equal(blobs.size, beforeBlobs + 1, "the original key retries once after the SQL fault is removed");
});
test("real images from another row or workspace cannot be read or linked through this document", async () => {
  const [workspace] = await resource.db.insert(workspaces).values({ organizationId: org, name: "Private images", isDefault: false }).returning();
  const [foreignTable] = await resource.db.insert(tables).values({ organizationId: org, workspaceId: workspace.id, name: "Other articles" }).returning();
  const foreignDeps = { ...a, workspaceId: workspace.id };
  const current = (await call("getDocument", identity()))!;
  for (const target of [{ tableId, deps: a }, { tableId: foreignTable.id, deps: foreignDeps }]) {
    const [row] = await resource.db.insert(rows).values({ tableId: target.tableId }).returning();
    const location = { tableId: target.tableId, rowId: row.id };
    await call("createDocument", { ...location, content: EMPTY_DOCUMENT, idempotencyKey: k() }, target.deps);
    const image = await call("uploadDocumentImage", { ...location, expectedVersion: 1, name: "foreign.png", mimeType: "image/png", base64: png, idempotencyKey: k() }, target.deps);
    assert.equal((await call("getDocumentImage", { ...location, fileId: image.fileId }, target.deps)).base64, png);
    await assert.rejects(call("getDocumentImage", { ...identity(), fileId: image.fileId }), code("NOT_FOUND"));
    const content: DocumentContent = { type: "doc", content: [{ type: "image", attrs: { fileId: image.fileId, alt: "Foreign asset" } }] };
    await assert.rejects(call("replaceDocument", { ...identity(), expectedVersion: current.version, content, idempotencyKey: k() }), code("BAD_INPUT"));
  }
  assert.deepEqual(await call("getDocument", identity()), current);
});

test("first body save is lazy, CAS serialized, idempotent and requires independent create plus update grants", async () => {
  const [row] = await resource.db.insert(rows).values({ tableId }).returning();
  const scope = { tableId, rowId: row.id };
  assert.equal(await call("getDocument", scope), null);
  const count = (await resource.db.select().from(recordDocuments)).length;
  assert.equal(await call("getDocument", scope), null);
  assert.equal((await resource.db.select().from(recordDocuments)).length, count);
  const input = { ...scope, expectedVersion: 0, content: body("首次输入"), idempotencyKey: k() };
  const key = await createSiteKey(a, actor, { name: "Update alone", permissions: [], documentPermissions: [grant({ canUpdate: true })] });
  await assert.rejects(call("replaceDocument", input, a, { kind: "key", secret: key.secret }), code("FORBIDDEN"));
  await updateSiteKey(a, actor, key.key.id, { name: "Create and update", permissions: [], documentPermissions: [grant({ canUpdate: true, canCreate: true })] });
  const [first, replay] = await Promise.all([call("replaceDocument", input, a, { kind: "key", secret: key.secret }), call("replaceDocument", input, b, { kind: "key", secret: key.secret })]);
  assert.deepEqual(first, replay); assert.equal(first.version, 1); assert(!("content" in first));
  await assert.rejects(call("replaceDocument", { ...input, idempotencyKey: k() }), code("VERSION_CONFLICT"));
  await assert.rejects(call("createDocument", { ...scope, content: body("legacy"), idempotencyKey: k() }), code("ALREADY_EXISTS"));
  assert.equal((await resource.db.select().from(documentRevisions).where(eq(documentRevisions.documentId, first.id))).length, 0);
  assert.equal((await resource.db.select().from(rows).where(eq(rows.id, row.id)))[0].version, 1);
  await updateSiteKey(a, actor, key.key.id, { name: "Shrunk", permissions: [], documentPermissions: [grant({ canRead: true })] });
  await assert.rejects(call("replaceDocument", input, a, { kind: "key", secret: key.secret }), code("FORBIDDEN"));
  const [race] = await resource.db.insert(rows).values({ tableId }).returning();
  const raced = await Promise.allSettled([a, b].map(deps => call("replaceDocument", { ...input, rowId: race.id, idempotencyKey: k() }, deps)));
  assert.equal(raced.filter(r => r.status === "fulfilled").length, 1);
  assert(code("VERSION_CONFLICT")((raced.find(r => r.status === "rejected") as PromiseRejectedResult).reason));
  const [rollback] = await resource.db.insert(rows).values({ tableId }).returning();
  await assert.rejects(resource.db.transaction(async tx => { await executeDocument(a, caller, "replaceDocument", { ...input, rowId: rollback.id, idempotencyKey: k() }, tx); throw new Error("late lazy rollback"); }), /late lazy rollback/);
  assert.equal(await call("getDocument", { ...scope, rowId: rollback.id }), null);
});

test("new formatting survives SDK replace/read/render; unsafe attrs fail without changing the current document", async () => {
  const api = createSiteApiRoutes(async () => ({ commands: a, identity: { database: a.database, resolveSession: async () => null }, siteRateLimit: async () => {}, async close() {} }));
  const key = await createSiteKey(a, actor, { name: "Formatting", permissions: [], documentPermissions: [grant({ canRead: true, canUpdate: true })] });
  const { Hono } = await import("hono");
  const host = new Hono().route("/api", api);
  const sdk = createClient({ url: "http://local.test", key: key.secret, fetch: (async (input: RequestInfo | URL, init?: RequestInit) => host.request(new Request(input, init))) as typeof fetch });
  const current = (await sdk.documents.getDocument(identity()))!;
  const content: DocumentContent = { type: "doc", content: [{ type: "heading", attrs: { level: 2, textAlign: "center" }, content: [{ type: "text", text: "Styled <heading>", marks: [{ type: "underline" }, { type: "textStyle", attrs: { color: "#337ea9" } }, { type: "highlight", attrs: { color: "#fdecc8" } }] }] }, { type: "paragraph", attrs: { textAlign: "justify" }, content: [{ type: "text", text: "Second paragraph" }] }] };
  await sdk.documents.replaceDocument({ ...identity(), expectedVersion: current.version, content, idempotencyKey: k() });
  const reloaded = (await sdk.documents.getDocument(identity()))!; assert.deepEqual(reloaded.content, content);
  const rendered = await sdk.documents.renderDocument(identity());
  assert(rendered.html.includes('<h2 style="text-align:center">')); assert(rendered.html.includes('<u>Styled &lt;heading&gt;</u>')); assert(rendered.html.includes('style="color:#337ea9"')); assert(rendered.html.includes('style="background-color:#fdecc8;color:inherit"')); assert(rendered.html.includes('<p style="text-align:justify">'));
  for (const invalid of [{ ...content.content[0], attrs: { level: 2, textAlign: "center;position:fixed" } }, { type: "paragraph", content: [{ type: "text", text: "bad", marks: [{ type: "textStyle", attrs: { color: "#ffffff;background:url(x)" } }] }] }]) {
    await assert.rejects(sdk.documents.replaceDocument({ ...identity(), expectedVersion: reloaded.version, content: { type: "doc", content: [invalid] } as DocumentContent, idempotencyKey: k() }));
    assert.throws(() => renderDocumentHtml({ type: "doc", content: [invalid] } as DocumentContent));
  }
  assert.deepEqual((await sdk.documents.getDocument(identity()))!.content, content);
});
