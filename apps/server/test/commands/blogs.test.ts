import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createDatabase } from "../../src/business/db/factory.js";
import { organization, user, member, workspaces, tables, columns, rows, documentImages, fileObjects, sites, siteRevisions, blogPreviews, blogReceipts, blogStorageGarbage } from "../../src/business/db/schema.js";
import { executeBlog, type BlogCaller } from "../../src/business/blogs/service.js";
import { BlogError } from "../../src/business/blogs/errors.js";
import { blogStorageKey, collectBlogStorage } from "../../src/business/blogs/storage.js";
import { executeDocument } from "../../src/business/documents/service.js";
import { createStorageAdapter } from "../../src/storage/adapter.js";
import { createSiteAssetsRoute, createSitesRoute } from "../../src/business/http/sites.js";
import { createSiteApiRoutes } from "../../src/business/http/site-api.js";
import { createCommandsRoute } from "../../src/business/http/commands.js";
import { createSiteKey, updateSiteKey } from "../../src/business/data-api/keys.js";
import { deleteRow, deleteTable, batchDeleteRows } from "../../src/business/commands/rows.js";
import { saveSite, publishSite, deleteSite } from "../../src/business/sites/service.js";
import { createBlogTools } from "../../src/business/agent/tools/blogs.js";
import { createClient } from "@tabdo/sdk";
import type { CommandDependencies } from "../../src/business/dependencies.js";
import type { Actor } from "../../src/business/auth/actor.js";
import type { BlogCommand, BlogCommands, BlogConfig, BlogDetail, BlogPermission, DocumentContent } from "@tabdo/shared";
const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test")); assert.equal(url, process.env.DATABASE_URL_UNPOOLED);
const resource = createDatabase({ connectionString: url, poolMax: 8 }), other = createDatabase({ connectionString: url, poolMax: 4 });
const k = randomUUID, org = k(), uid = k(), mid = k(); let workspaceId: string, tableId: string, titleId: string, slugId: string, privateId: string, tagId: string, directory: string;
let puts = 0, failAt = Infinity, now = new Date();
let a: CommandDependencies, b: CommandDependencies;
const who: BlogCaller = { kind: "member", organizationId: org, actorId: uid };
const actor: Actor = { kind: "human", userId: uid, memberId: mid, organizationId: org, role: "owner", name: "Public author", email: `${uid}@local.test` };
const call = <K extends BlogCommand>(command: K, input: BlogCommands[K], deps = a, caller: BlogCaller = who) => executeBlog(deps, caller, command, input);
const body = (text: string): DocumentContent => ({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "A heading" }] }, { type: "paragraph", content: [{ type: "text", text }] }, { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Another heading" }] }] });
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVQIHWP4DwABAQEAG7buVgAAAABJRU5ErkJggg==";
const isCode = (code: string) => (error: unknown) => error instanceof BlogError && error.code === code;
function depsFor(r: typeof resource): CommandDependencies {
  const storage = createStorageAdapter({ driver: "local", localDir: directory });
  return { database: r.db, workspaceId, uuid: k, now: () => now, afterCommit: r.afterCommit, afterRollback: r.afterRollback, automationQueueName: "unused", sites: { publicOrigin: "http://blog.test", apiOrigin: "http://blog.test", appOrigin: "http://app.test", sdkUrl: "https://example.test/sdk.js", storageDriver: "local", storage: () => ({ ...storage, async put(key, bytes, mime) { if (++puts === failAt) throw new Error("injected upload failure"); return storage.put(key, bytes, mime); } }) } };
}
const acquire = async () => ({ commands: a, identity: { database: a.database, resolveSession: async () => null }, siteRateLimit: async () => {}, async close() {} });
const app = new Hono().route("/api", createSiteApiRoutes(acquire)).route("/api/commands", createCommandsRoute(acquire)).route("/api/sites", createSitesRoute(acquire)).route("/", createSiteAssetsRoute(acquire));
async function page(blog: BlogDetail, path = "") { let response = await app.request(blog.publicUrl + path); if (response.status === 302) response = await app.request(response.headers.get("Location")!); return response; }
async function fixture(count = 2) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const [row] = await resource.db.insert(rows).values({ tableId, cells: { [titleId]: `Article ${i}`, [slugId]: `article-${i}`, [privateId]: "PRIVATE-SECRET", [tagId]: ["news"] } }).returning();
    ids.push(row.id); await executeDocument(a, who as any, "createDocument", { tableId, rowId: row.id, content: body(`Original body ${i}`), idempotencyKey: k() });
  }
  const config: BlogConfig = { tableId, authorName: "Public author", language: "en", description: "A public blog", mapping: { title: titleId, slug: slugId, tags: tagId }, articles: ids.map(rowId => ({ rowId, imageIds: [] })) };
  const saved = await call("saveBlog", { name: "Fixture blog", config, idempotencyKey: k() });
  return { ids, saved, config };
}
async function build(blog: BlogDetail) { return call("buildBlog", { siteId: blog.id, expectedVersion: blog.version, idempotencyKey: k() }); }
async function publish(blog: BlogDetail, caller = who) {
  const input = { siteId: blog.id, buildId: blog.revisionId, expectedVersion: blog.version, expectedPublishedRevisionId: blog.publishedRevisionId };
  const permit = await call("authorizeBlogPublication", { ...input, action: "publishBlog", idempotencyKey: k() });
  return call("publishBlog", { ...input, authorizationToken: permit.authorizationToken, idempotencyKey: k() }, a, caller);
}
async function recall(blog: BlogDetail, rowId?: string) {
  const action = rowId ? "withdrawBlogArticle" : "unpublishBlog", input = { siteId: blog.id, expectedVersion: blog.version, expectedPublishedRevisionId: blog.publishedRevisionId, ...(rowId ? { rowId } : {}) };
  const permit = await call("authorizeBlogPublication", { ...input, action, idempotencyKey: k() });
  return rowId ? call("withdrawBlogArticle", { ...input, rowId, authorizationToken: permit.authorizationToken, idempotencyKey: k() }) : call("unpublishBlog", { ...input, authorizationToken: permit.authorizationToken, idempotencyKey: k() });
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "tabdo-0052-blog-"));
  await resource.db.insert(organization).values({ id: org, name: "Blog tests", slug: org });
  await resource.db.insert(user).values({ id: uid, name: actor.name, email: actor.email });
  await resource.db.insert(member).values({ id: mid, userId: uid, organizationId: org, role: "owner" });
  const [workspace] = await resource.db.select().from(workspaces).where(eq(workspaces.organizationId, org)); workspaceId = workspace.id; actor.workspaceId = workspaceId;
  a = depsFor(resource); b = depsFor(other);
  const [table] = await resource.db.insert(tables).values({ workspaceId, organizationId: org, name: "Blog sources" }).returning(); tableId = table.id;
  const fields = await resource.db.insert(columns).values(["Title", "Slug", "Secret", "Tags"].map((name, i) => ({ tableId, name, type: i === 3 ? "multi_select" : "text", config: i === 3 ? { options: [{ id: "news", label: "News" }] } : {} }))).returning();
  [titleId, slugId, privateId, tagId] = fields.map(f => f.id);
});
after(async () => { await resource.db.delete(organization).where(eq(organization.id, org)); await resource.db.delete(user).where(eq(user.id, uid)); await other.close(); await resource.close(); await rm(directory, { recursive: true, force: true }); });

test("explicit snapshots produce readable HTML, metadata and topics, with no table keys or private fields", async () => {
  const { saved, ids } = await fixture();
  assert.equal((await page(saved)).status, 404);
  const built = await build(saved); assert.equal((await page(built)).status, 404);
  const blog = await publish(built), html = await (await page(blog)).text();
  assert(html.includes("Article 0")); assert(!html.includes("PRIVATE-SECRET")); assert(!html.includes("<script")); assert(!html.includes("tab_"));
  const detail = await (await page(blog, "articles/article-0.html")).text();
  assert(detail.includes("Original body 0")); assert(detail.includes('property="og:title"')); assert(detail.includes('rel="canonical"')); assert(detail.includes('aria-label="Contents"')); assert(!detail.includes(actor.email)); assert(!detail.includes(uid));
  assert.equal((await page(blog, "topics/1.html")).status, 200);
  const manifest = blog.manifest!; assert.equal(manifest.buildId, blog.revisionId); assert.match(manifest.hash, /^[a-f0-9]{64}$/); assert.equal(manifest.articles[0].rowVersion, 1);
  assert.equal((await page(blog, "manifest.json")).status, 404);
  await assert.rejects(deleteRow(a, { organizationId: org, rowId: ids[0] }), isCode("SOURCE_CHANGED"));
  await assert.rejects(deleteTable(a, { organizationId: org, tableId }), isCode("SOURCE_CHANGED"));
  await assert.rejects(deleteSite(a, { organizationId: org, siteId: blog.id }), isCode("UNPUBLISH_REQUIRED"));
  const [unpublished] = await resource.db.insert(rows).values({ tableId, cells: { [titleId]: "Unpublished row" } }).returning();
  await resource.db.transaction(async tx => {
    await assert.rejects(batchDeleteRows(a, { organizationId: org, rowIds: [unpublished.id, ids[0]] }, tx), isCode("SOURCE_CHANGED"));
    await tx.execute(sql`select 1`);
  });
  assert.equal((await resource.db.select().from(rows).where(eq(rows.id, unpublished.id))).length, 1, "a caught host error must not delete the preceding unpublished row");
  const generic = await app.request(`http://blog.test/api/sites/${blog.id}/preview`, { method: "POST", body: JSON.stringify({ files: [{ path: "index.html", content: "bypass" }] }), headers: { "Content-Type": "application/json" } }); assert.equal(generic.status, 401);
  await assert.rejects(publishSite(a, { organizationId: org, siteId: blog.id, revisionId: blog.revisionId }), /publishBlog/);
});

test("blog pagination and generated output budgets are enforced before creating a build", async () => {
  const { saved } = await fixture(11), published = await publish(await build(saved));
  const first = await (await page(published)).text(), second = await (await page(published, "page-2.html")).text();
  assert.equal(first.match(/<article>/g)?.length, 10); assert.equal(second.match(/<article>/g)?.length, 1);
  const large = await fixture(20);
  for (const rowId of large.ids) await executeDocument(a, who as any, "replaceDocument", { tableId, rowId, expectedVersion: 1, content: body("&".repeat(45000)), idempotencyKey: k() });
  await assert.rejects(build(large.saved), isCode("LIMIT_EXCEEDED"));
  const unchanged = await call("getBlog", { siteId: large.saved.id }); assert.equal(unchanged.version, 1); assert.equal(unchanged.revisions.length, 1); assert.equal(unchanged.publishedRevisionId, null);
});

test("source edits stay private, stale source/config/publication CAS fails, and retries are immutable", async () => {
  const { saved, ids } = await fixture(); let blog = await publish(await build(saved));
  const doc = await executeDocument(a, who as any, "getDocument", { tableId, rowId: ids[0] });
  await executeDocument(a, who as any, "replaceDocument", { tableId, rowId: ids[0], expectedVersion: doc!.version, content: body("Edited but not published"), idempotencyKey: k() });
  assert(!(await (await page(blog, "articles/article-0.html")).text()).includes("Edited but not published"));
  assert((await call("getBlog", { siteId: blog.id })).pendingChanges);
  const stale = await build(blog); await resource.db.update(rows).set({ version: 2, cells: { [titleId]: "Changed title", [slugId]: "renamed", [privateId]: "secret" } }).where(eq(rows.id, ids[0]));
  await assert.rejects(publish(stale), isCode("SOURCE_CHANGED"));
  const fresh = await build(stale); blog = await publish(fresh);
  assert((await (await page(blog, "articles/renamed.html")).text()).includes("Edited but not published"));
  const oldUrl = `${blog.publicUrl}v/${stale.revisionId}/articles/article-0.html`; assert.equal((await app.request(oldUrl)).status, 404);
  await assert.rejects(call("publishBlog", { siteId: blog.id, buildId: fresh.revisionId, expectedVersion: fresh.version, expectedPublishedRevisionId: null, idempotencyKey: k() }), isCode("VERSION_CONFLICT"));
  const input = { siteId: blog.id, expectedVersion: blog.version, idempotencyKey: k() };
  const built = await call("buildBlog", input); assert.deepEqual(await call("buildBlog", input), built);
  await assert.rejects(call("buildBlog", { ...input, expectedVersion: built.version }), isCode("IDEMPOTENCY_MISMATCH"));
  const [left, right] = await Promise.allSettled([call("buildBlog", { ...input, expectedVersion: built.version, idempotencyKey: k() }), call("buildBlog", { ...input, expectedVersion: built.version, idempotencyKey: k() }, b)]);
  assert.equal([left, right].filter(r => r.status === "fulfilled").length, 1);
});

test("binary assets require selection, preview is revocable, and recalling invalidates every old route", async () => {
  const { saved, ids, config } = await fixture();
  const images: string[] = [];
  for (const rowId of ids) {
    const uploaded = await executeDocument(a, who as any, "uploadDocumentImage", { tableId, rowId, expectedVersion: 1, name: "private-name.png", mimeType: "image/png", base64: png, idempotencyKey: k() }); images.push(uploaded.fileId);
    await executeDocument(a, who as any, "replaceDocument", { tableId, rowId, expectedVersion: 1, content: { ...body("With images"), content: [...body("With images").content, { type: "image", attrs: { fileId: uploaded.fileId, alt: '\" onerror=alert(1)' } }] }, idempotencyKey: k() });
  }
  config.articles.forEach((article, i) => { article.imageIds = [images[i]]; });
  const configured = await call("saveBlog", { siteId: saved.id, expectedVersion: saved.version, name: saved.name, config, idempotencyKey: k() });
  const built = await build(configured), preview = await call("createBlogPreview", { siteId: saved.id, buildId: built.revisionId, idempotencyKey: k() });
  assert.equal((await app.request(preview.url)).status, 200); assert.match((await app.request(preview.url)).headers.get("X-Robots-Tag")!, /noindex/);
  assert.equal((await app.request(new URL(built.manifest!.assets[0].path, preview.url).href)).headers.get("Content-Type"), "image/png");
  now = new Date(now.getTime() + 11 * 60_000); assert.equal((await app.request(preview.url)).status, 404);
  const activePreview = await call("createBlogPreview", { siteId: saved.id, buildId: built.revisionId, idempotencyKey: k() });
  await call("revokeBlogPreviews", { siteId: saved.id, idempotencyKey: k() }); assert.equal((await app.request(activePreview.url)).status, 404);
  let blog = await publish(built); const old = blog.revisionId, asset = blog.manifest!.assets[0].path;
  const html = await (await page(blog, "articles/article-0.html")).text(); assert(html.includes("&quot; onerror")); assert(!html.includes("private-name")); assert(!html.includes("document-assets")); assert.equal(blog.manifest!.assets.length, 1, "identical approved bytes share a public asset");
  blog = await recall(blog, ids[0]); assert.equal((await page(blog, "articles/article-0.html")).status, 404);
  assert.equal((await app.request(`${blog.publicUrl}v/${old}/articles/article-0.html`)).status, 404);
  assert.equal((await app.request(`${blog.publicUrl}v/${old}/${asset}`)).status, 404);
  assert.equal((await page(blog, "articles/article-1.html")).status, 200); assert.equal((await page(blog, asset)).status, 200);
  await deleteRow(a, { rowId: ids[0], organizationId: org });
  blog = await recall(blog); assert.equal((await page(blog)).status, 404); assert.equal((await app.request(`${blog.publicUrl}v/${blog.revisionId}/${asset}`)).status, 404);
});

test("covers, omitted images, unsafe links and deleted asset preconditions use controlled snapshots only", async () => {
  const { saved, ids, config } = await fixture(2);
  const [coverColumn] = await resource.db.insert(columns).values({ tableId, name: `Cover ${k()}`, type: "file", config: {} }).returning();
  const fileId = k(), sourceKey = `${fileId.slice(0, 2)}/${fileId}`;
  await a.sites!.storage("local").put(sourceKey, Uint8Array.from(atob(png), c => c.charCodeAt(0)), "image/png");
  await resource.db.insert(fileObjects).values({ id: fileId, tableId, columnId: coverColumn.id, organizationId: org, workspaceId, name: "private-cover-name.png", mimeType: "image/png", size: atob(png).length, storageDriver: "local", storageKey: sourceKey });
  const [row] = await resource.db.select().from(rows).where(eq(rows.id, ids[0]));
  await resource.db.update(rows).set({ cells: { ...row.cells, [coverColumn.id]: [fileId] }, version: 2 }).where(eq(rows.id, row.id));
  const image = await executeDocument(a, who as any, "uploadDocumentImage", { tableId, rowId: ids[0], expectedVersion: 1, name: "not-selected.png", mimeType: "image/png", base64: png, idempotencyKey: k() });
  await executeDocument(a, who as any, "replaceDocument", { tableId, rowId: ids[0], expectedVersion: 1, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Keep text, drop secret link", marks: [{ type: "link", attrs: { href: "http://blog.test/api/site-files/private?key=tab_THIS_IS_A_PRIVATE_TOKEN_12345" } }] }] }, { type: "blockquote", content: [{ type: "image", attrs: { fileId: image.fileId, alt: "Private omitted image" } }] }] }, idempotencyKey: k() });
  config.mapping.cover = coverColumn.id; config.articles = [{ rowId: ids[0], imageIds: [], coverFileId: fileId }];
  const configured = await call("saveBlog", { siteId: saved.id, expectedVersion: saved.version, name: saved.name, config, idempotencyKey: k() });
  const built = await build(configured); assert.equal(built.manifest!.assets.length, 1); assert.equal(built.manifest!.assets[0].sourceKind, "cover");
  const published = await publish(built, { kind: "native", organizationId: org, actorId: uid });
  const html = await (await page(published, "articles/article-0.html")).text(); assert(!html.includes("tab_")); assert(!html.includes("not-selected")); assert(!html.includes("Private omitted image")); assert(!html.includes("private-cover-name")); assert(html.includes('property="og:image"'));
  const fresh = await build(published); await resource.db.delete(fileObjects).where(eq(fileObjects.id, fileId));
  await assert.rejects(publish(fresh), isCode("SOURCE_CHANGED"));
  // Existing public copy has its own ownership after source deletion.
  assert.equal((await page(published, published.manifest!.assets[0].path)).status, 200);
  const invalid = { ...config, articles: [{ rowId: ids[1], imageIds: [image.fileId] }] };
  const bad = await call("saveBlog", { siteId: published.id, expectedVersion: fresh.version, name: saved.name, config: invalid, idempotencyKey: k() });
  await assert.rejects(build(bad), isCode("BAD_INPUT"));
});

test("public person author labels are fixed, checked as source dependencies and never expose emails or IDs", async () => {
  const { saved, ids, config } = await fixture(1);
  const [field] = await resource.db.insert(columns).values({ tableId, name: `Author ${k()}`, type: "person", config: {} }).returning();
  const [row] = await resource.db.select().from(rows).where(eq(rows.id, ids[0]));
  await resource.db.update(rows).set({ cells: { ...row.cells, [field.id]: [uid] }, version: 2 }).where(eq(rows.id, row.id)); config.mapping.author = field.id;
  let blog = await call("saveBlog", { siteId: saved.id, name: saved.name, config, expectedVersion: saved.version, idempotencyKey: k() });
  blog = await build(blog); await resource.db.update(user).set({ name: "Renamed public author" }).where(eq(user.id, uid));
  try {
    await assert.rejects(publish(blog), isCode("SOURCE_CHANGED"));
    const published = await publish(await build(blog)), html = await (await page(published, "articles/article-0.html")).text();
    assert(html.includes("Renamed public author")); assert(!html.includes(uid)); assert(!html.includes(actor.email));
  } finally { await resource.db.update(user).set({ name: actor.name }).where(eq(user.id, uid)); }
});

test("anonymous published HTML never retains access_token or api_key hyperlink credentials", async () => {
  const { saved, ids } = await fixture(1);
  const secrets = { accessToken: `PRIVATE_OAUTH_${k()}`, apiKey: `PRIVATE_API_${k()}`, knownToken: `PRIVATE_TOKEN_${k()}` };
  const link = (text: string, href: string) => ({ type: "text" as const, text, marks: [{ type: "link" as const, attrs: { href } }] });
  await executeDocument(a, who as any, "replaceDocument", { tableId, rowId: ids[0], expectedVersion: 1, content: { type: "doc", content: [{ type: "paragraph", content: [
    link("OAuth download", `https://files.example.test/download?access_token=${secrets.accessToken}`),
    link("API download", `https://files.example.test/download?api_key=${secrets.apiKey}`),
    link("Known token control", `https://files.example.test/download?token=${secrets.knownToken}`),
    link("Public search", "https://example.test/search?q=release"),
  ] }] }, idempotencyKey: k() });
  const published = await publish(await build(saved));
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/s/${published.id}/v/${published.publishedRevisionId}/articles/article-0.html`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert(html.includes('href="https://example.test/search?q=release"'), "ordinary public links remain usable");
    assert(!html.includes(secrets.knownToken), "the existing token guard remains effective");
    const leaks = { accessToken: html.includes(secrets.accessToken), apiKey: html.includes(secrets.apiKey) };
    console.log("BLOG_ANONYMOUS_CREDENTIAL_LINKS", JSON.stringify(leaks));
    assert.deepEqual(leaks, { accessToken: false, apiKey: false }, "Public snapshots must strip credential-bearing links, not just the exact token query key");
  } finally { if ("closeAllConnections" in server) server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("upload and transaction failures are recoverable using durable plans and exclusive-create storage", async () => {
  const { saved } = await fixture(1); let blog = await publish(await build(saved)); const before = blog.publishedRevisionId;
  const next = await build(blog), input = { siteId: blog.id, buildId: next.revisionId, expectedVersion: next.version, expectedPublishedRevisionId: before, idempotencyKey: k() };
  const { authorizationToken } = await call("authorizeBlogPublication", { ...input, action: "publishBlog", idempotencyKey: k() });
  failAt = puts + 2;
  await assert.rejects(call("publishBlog", { ...input, authorizationToken }), isCode("STORAGE_UNAVAILABLE")); failAt = Infinity;
  assert.equal((await call("getBlog", { siteId: blog.id })).publishedRevisionId, before);
  // Actual late outer rollback after uploads and SQL mutations. The persisted build remains the recovery plan.
  await assert.rejects(resource.db.transaction(async tx => { await executeBlog(a, who, "publishBlog", { ...input, authorizationToken }, tx); throw new Error("late outer rollback"); }), /late outer rollback/);
  assert.equal((await call("getBlog", { siteId: blog.id })).publishedRevisionId, before);
  blog = await call("publishBlog", { ...input, authorizationToken }); assert.equal(blog.publishedRevisionId, next.revisionId);
  assert.deepEqual(await call("publishBlog", { ...input, authorizationToken }), blog);
  // A half-written deterministic object is repaired on retry, never advertised as a completed build.
  const damaged = await build(blog), key = await blogStorageKey(damaged.revisionId, "index.html");
  await a.sites!.storage("local").put(key, new Uint8Array([1]), "text/html");
  assert.equal((await publish(damaged)).publishedRevisionId, damaged.revisionId);
});

test("real process death and a deferred COMMIT failure retain a recoverable unpublished build", async () => {
  const { saved } = await fixture(1), built = await build(saved);
  const input = { siteId: built.id, buildId: built.revisionId, expectedVersion: built.version, expectedPublishedRevisionId: null, idempotencyKey: k() };
  const permit = await call("authorizeBlogPublication", { ...input, action: "publishBlog", idempotencyKey: k() });
  const request = { ...input, authorizationToken: permit.authorizationToken }, file = join(directory, "crash-input.json");
  await writeFile(file, JSON.stringify({ org, uid, workspaceId, directory, now, request }));
  const child = spawn(process.execPath, ["--import", "tsx", "test/fixtures/blog-crash-publisher.ts", file], { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  let stderr = ""; child.stderr.on("data", value => { stderr += value; });
  const code = await new Promise(resolve => child.once("exit", resolve)); assert.equal(code, 27, stderr);
  assert.equal((await call("getBlog", { siteId: built.id })).publishedRevisionId, null);
  const fn = `blog_commit_${k().replaceAll("-", "")}`, trigger = `${fn}_trigger`;
  await resource.db.execute(sql.raw(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${built.id}' AND NEW.published_revision_id = '${built.revisionId}' THEN RAISE EXCEPTION 'injected deferred commit failure'; END IF; RETURN NEW; END $$`));
  await resource.db.execute(sql.raw(`CREATE CONSTRAINT TRIGGER ${trigger} AFTER UPDATE ON sites DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${fn}()`));
  try { await assert.rejects(call("publishBlog", request), /injected deferred commit failure|Failed query/); }
  finally { await resource.db.execute(sql.raw(`DROP TRIGGER ${trigger} ON sites`)); await resource.db.execute(sql.raw(`DROP FUNCTION ${fn}()`)); }
  assert.equal((await call("getBlog", { siteId: built.id })).publishedRevisionId, null);
  assert.equal((await call("publishBlog", request)).publishedRevisionId, built.revisionId);
  await rm(file);
});

test("dedicated grants cover REST/GraphQL/SDK while table/read keys and native execution cannot publish", async () => {
  const { saved } = await fixture(1), built = await build(saved);
  const grant = (overrides: Partial<BlogPermission> = {}): BlogPermission => ({ tableId, canRead: true, canConfigure: false, canBuild: false, canPublish: false, canRestore: false, ...overrides });
  const readKey = await createSiteKey(a, actor, { name: "Reader", permissions: [], documentPermissions: [{ tableId, canRead: true, canCreate: false, canUpdate: false, canReadHistory: false, canRestore: false, canUpload: false }], blogPermissions: [grant()] });
  const fetcher: typeof fetch = async (input, init) => app.request(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init);
  const sdk = createClient({ url: "http://blog.test", key: readKey.secret, fetch: fetcher });
  assert.equal((await sdk.blogs.getBlog({ siteId: saved.id })).revisionId, built.revisionId);
  const input = { siteId: saved.id, buildId: built.revisionId, expectedVersion: built.version, expectedPublishedRevisionId: null, idempotencyKey: k() };
  await assert.rejects(sdk.blogs.publishBlog(input), /granted|permission/i);
  const result = await app.request("http://blog.test/api/commands", { method: "POST", headers: { Authorization: `Bearer ${readKey.secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ command: "publishBlog", input }) }); assert.equal(result.status, 403);
  const tools = createBlogTools(a, org, uid); const count = (await resource.db.select().from(blogReceipts).where(eq(blogReceipts.workspaceId, workspaceId))).length;
  await resource.db.transaction(async tx => {
    const native = createBlogTools(a, org, uid, tx); const output = await native.publish_blog.execute!(input, { toolCallId: k(), messages: [], context: {} }); assert.equal((output as any).error.code, "PUBLICATION_APPROVAL_REQUIRED");
    await tx.execute(sql`select 1`);
  });
  assert.equal((await resource.db.select().from(blogReceipts).where(eq(blogReceipts.workspaceId, workspaceId))).length, count); assert(!tools.authorize_blog_publication);
  await updateSiteKey(a, actor, readKey.key.id, { name: "Publisher", permissions: [], blogPermissions: [grant({ canPublish: true })], documentPermissions: readKey.key.documentPermissions });
  assert.equal((await sdk.blogs.publishBlog(input)).publishedRevisionId, built.revisionId);
  await updateSiteKey(a, actor, readKey.key.id, { name: "Reader again", permissions: [], blogPermissions: [grant()], documentPermissions: readKey.key.documentPermissions });
  await assert.rejects(sdk.blogs.unpublishBlog({ siteId: saved.id, expectedVersion: built.version, expectedPublishedRevisionId: built.revisionId, idempotencyKey: k() }), /granted|permission/i);
  assert((await sdk.documents.getDocument({ tableId, rowId: built.manifest!.articles[0].rowId }))?.content);
  const tableKey = await createSiteKey(a, actor, { name: "Old table key", permissions: [{ tableId, canRead: true, canCreate: false, canUpdate: false, canDelete: false }] });
  await assert.rejects(call("getBlog", { siteId: saved.id }, a, { kind: "key", secret: tableKey.secret }), isCode("NOT_FOUND"));
});

test("scope, approval expiry and mismatched intent cannot bypass publication", async () => {
  const { saved } = await fixture(1), built = await build(saved), foreign = k();
  await resource.db.insert(workspaces).values({ id: foreign, organizationId: org, name: "Other workspace" });
  await assert.rejects(call("getBlog", { siteId: built.id }, { ...a, workspaceId: foreign }), isCode("NOT_FOUND"));
  const input = { siteId: built.id, expectedVersion: built.version, expectedPublishedRevisionId: null, buildId: built.revisionId, idempotencyKey: k() };
  const approval = await call("authorizeBlogPublication", { ...input, action: "unpublishBlog" });
  await assert.rejects(call("publishBlog", { ...input, idempotencyKey: k(), authorizationToken: approval.authorizationToken }), isCode("PUBLICATION_APPROVAL_REQUIRED"));
  const permit = await call("authorizeBlogPublication", { ...input, action: "publishBlog", idempotencyKey: k() }); now = new Date(now.getTime() + 6 * 60_000);
  await assert.rejects(call("publishBlog", { ...input, idempotencyKey: k(), authorizationToken: permit.authorizationToken }), isCode("PUBLICATION_APPROVAL_REQUIRED"));
  const untrusted = await resource.db.insert(user).values({ id: k(), kind: "agent", name: "Agent", email: `${k()}@local.test` }).returning();
  try {
    await resource.db.insert(member).values({ id: k(), userId: untrusted[0].id, organizationId: org, role: "owner" });
    await assert.rejects(call("authorizeBlogPublication", { ...input, action: "publishBlog", idempotencyKey: k() }, a, { kind: "member", organizationId: org, actorId: untrusted[0].id }), isCode("FORBIDDEN"));
  } finally { await resource.db.delete(user).where(eq(user.id, untrusted[0].id)); }
});

test("internal restore is a draft and ordinary code site history remains compatible", async () => {
  const { saved } = await fixture(1); const published = await publish(await build(saved));
  const restored = await call("restoreBlogRevision", { siteId: saved.id, revisionId: saved.revisionId, expectedVersion: published.version, idempotencyKey: k() });
  assert.equal(restored.publishedRevisionId, published.revisionId); assert.equal(restored.manifest, null); assert.equal((await page(restored)).status, 200);
  const scope = { organizationId: org, actorId: uid };
  const code = await saveSite(a, { ...scope, name: "Code", files: [{ path: "index.html", content: "Old code" }] }); await publishSite(a, { ...scope, siteId: code.id, revisionId: code.revisionId });
  const newer = await saveSite(a, { ...scope, name: "Code", siteId: code.id, expectedVersion: code.version, files: [{ path: "index.html", content: "New code" }] }); await publishSite(a, { ...scope, siteId: code.id, revisionId: newer.revisionId });
  assert.equal(await (await app.request(`${code.publicUrl}v/${code.revisionId}/index.html`)).text(), "Old code");
});

test("delete retains durable garbage plans on storage failure and retries collection", async () => {
  const { saved } = await fixture(1), built = await build(saved); const published = await publish(built), recalled = await recall(published);
  const failing: CommandDependencies = { ...a, afterCommit: undefined, sites: { ...a.sites!, storage: () => ({ ...a.sites!.storage("local"), async remove() { throw new Error("offline"); } }) } };
  await deleteSite(failing, { siteId: recalled.id, organizationId: org });
  assert.equal((await page(recalled)).status, 404); assert((await resource.db.select().from(blogStorageGarbage)).length > 0);
  await collectBlogStorage(failing); assert((await resource.db.select().from(blogStorageGarbage)).length > 0);
  await collectBlogStorage(a); assert.equal((await resource.db.select().from(blogStorageGarbage)).length, 0);
  await assert.rejects(a.sites!.storage("local").open(await blogStorageKey(built.revisionId, "index.html")));
});
