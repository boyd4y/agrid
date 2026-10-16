import assert from "node:assert/strict";
import { before, after, test } from "../runtime.js";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createLocalStorage } from "@tabdo/storage/local";
import { createSitesRoute, createSiteAssetsRoute } from "../../src/business/http/sites.js";
import { createCommandsRoute } from "../../src/business/http/commands.js";
import { createTableTools } from "../../src/business/agent/tools/index.js";
import { resolveChatContext } from "../../src/business/chat/context.js";
import { commandDependencies } from "../../src/services/dependencies.js";
import { user, organization, member, session, sites, siteRevisions, sitePreviews } from "../../src/db/schema.js";
import { db, client } from "../../src/db/index.js";
import { auth } from "../../src/auth/index.js";
import type { RequestScopeResolver } from "../../src/business/http/request.js";
import type { SiteDetail, SiteSourceFile } from "@tabdo/shared";

const org = randomUUID(), foreign = randomUUID();
let directory = "", uid = "", cookie = "", current: SiteDetail, puts = 0, failAt = Infinity;
const inputFiles = (text: string): SiteSourceFile[] => [
  { path: "index.html", content: `<!doctype html><html><head><link rel="stylesheet" href="./assets/theme.css"></head><body><h1>${text}</h1><script type="module" src="./app.js"></script></body></html>` },
  { path: "assets/theme.css", content: "h1 { color: rgb(20, 80, 120); }" },
  { path: "app.js", content: "import { createClient } from './tabdo.js'; window.sdkReady = typeof createClient === 'function';" },
];
const dependencies = () => {
  const base = commandDependencies(), storage = createLocalStorage(directory);
  return { ...base, sites: { ...base.sites!, storage: (_driver: string) => ({ ...storage,
    async put(key: string, bytes: Uint8Array, mime: string) { if (++puts === failAt) throw new Error("Injected storage failure"); await storage.put(key, bytes, mime); },
  }) } };
};
const acquire: RequestScopeResolver = async () => {
  const commands = dependencies();
  return { commands, identity: { database: commands.database, resolveSession: headers => auth.api.getSession({ headers }) }, async close() {} };
};
const app = new Hono().route("/api/sites", createSitesRoute(acquire)).route("/api/commands", createCommandsRoute(acquire)).route("/", createSiteAssetsRoute(acquire));
const req = (path: string, value?: unknown, method = value === undefined ? "GET" : "POST", credentials = cookie) => app.request(`http://localhost:3001${path}`, { method, headers: { Cookie: credentials, "Content-Type": "application/json" }, body: value === undefined ? undefined : JSON.stringify(value) });
async function publicPage(id: string) {
  const redirect = await req(`/s/${id}/`, undefined, "GET", ""); assert.equal(redirect.status, 302);
  const location = redirect.headers.get("Location")!;
  return app.request(location);
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "tabdo-sites-test-"));
  const result = await auth.handler(new Request("http://localhost:3001/api/auth/sign-up/email", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" }, body: JSON.stringify({ email: `sites-${randomUUID()}@local.test`, name: "Site author", password: "Site-Test-123456!" }) }));
  assert.equal(result.status, 200); uid = (await result.json()).user.id;
  cookie = result.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  await db.insert(organization).values([{ id: org, name: "Sites test", slug: org }, { id: foreign, name: "Foreign sites", slug: foreign }]);
  await db.insert(member).values([{ id: randomUUID(), userId: uid, organizationId: org, role: "owner" }, { id: randomUUID(), userId: uid, organizationId: foreign, role: "owner" }]);
  await db.update(session).set({ activeOrganizationId: org }).where(eq(session.userId, uid));
});
after(async () => {
  await db.delete(organization).where(eq(organization.id, org)); await db.delete(organization).where(eq(organization.id, foreign));
  if (uid) await db.delete(user).where(eq(user.id, uid));
  await rm(directory, { recursive: true, force: true }); await client.end();
});
test("site source is scoped and versioned; preview is private and does not save or publish", async () => {
  assert.equal((await req("/api/sites", undefined, "GET", "")).status, 401);
  const saved = await req("/api/sites", { name: "Knowledge", files: inputFiles("First") }); assert.equal(saved.status, 201); current = await saved.json();
  assert.equal(current.version, 1); assert(current.files.some(file => file.path === "tabdo.js" && file.content.includes("createClient")));
  assert.equal((await req(`/s/${current.id}/`, undefined, "GET", "")).status, 404);
  const preview = await (await req(`/api/sites/${current.id}/preview`, { files: inputFiles("Unsaved"), generation: 1 })).json();
  const response = await app.request(preview.url); assert.equal(response.status, 200); assert((await response.text()).includes("Unsaved"));
  assert.match(response.headers.get("Content-Security-Policy")!, /^sandbox allow-scripts/); assert(!response.headers.get("Content-Security-Policy")!.includes("allow-same-origin"));
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal((await req(`/api/sites/${current.id}`)).status, 200); assert.equal((await (await req(`/api/sites/${current.id}`)).json()).version, 1);
  const updated = await req(`/api/sites/${current.id}/preview`, { files: inputFiles("Latest preview"), token: preview.token, generation: 3 }); assert.equal(updated.status, 200);
  assert.equal((await req(`/api/sites/${current.id}/preview`, { files: inputFiles("Stale"), token: preview.token, generation: 2 })).status, 404);
  assert((await (await app.request(preview.url)).text()).includes("Latest preview"));
  assert.equal((await req("/site-preview/not-a-token/")).status, 404);
  assert.equal((await req(`/api/sites/${current.id}/preview`, { files: [{ path: "../secret.html", content: "x" }]})).status, 400);
  await db.update(session).set({ activeOrganizationId: foreign }).where(eq(session.userId, uid));
  try {
    assert.equal((await req(`/api/sites/${current.id}`)).status, 404);
    assert.equal((await req(`/api/sites/${current.id}/publish`, { revisionId: current.revisionId })).status, 404);
    assert.equal((await req(`/api/sites/${current.id}/preview`, { files: inputFiles("Foreign") })).status, 404);
    await assert.rejects(resolveChatContext(dependencies(), { page: "sites", siteId: current.id }, { userId: uid, memberId: "", organizationId: foreign, kind: "human", role: "owner", name: "", email: "" }), /站点不存在/);
  } finally { await db.update(session).set({ activeOrganizationId: org }).where(eq(session.userId, uid)); }
});
test("publication serves real stored files; failed writes keep old publication; restoring makes a new version", async () => {
  const pub = await req(`/api/sites/${current.id}/publish`, { revisionId: current.revisionId }); assert.equal(pub.status, 200);
  const first = await publicPage(current.id); assert.equal(first.status, 200); assert((await first.text()).includes("First"));
  const firstRevision = current.revisionId;
  const second = await req("/api/sites", { siteId: current.id, name: "Knowledge", files: inputFiles("Second"), expectedVersion: 1 }); assert.equal(second.status, 200); current = await second.json();
  assert.equal((await req("/api/sites", { siteId: current.id, name: "Stale", files: inputFiles("Stale"), expectedVersion: 1 })).status, 409);
  assert((await (await publicPage(current.id)).text()).includes("First"));
  failAt = puts + 2;
  assert.equal((await req(`/api/sites/${current.id}/publish`, { revisionId: current.revisionId })).status, 500); failAt = Infinity;
  assert((await (await publicPage(current.id)).text()).includes("First"));
  assert.equal((await req(`/api/sites/${current.id}/publish`, { revisionId: current.revisionId })).status, 200);
  assert((await (await publicPage(current.id)).text()).includes("Second"));
  const stored = (await db.select().from(siteRevisions).where(eq(siteRevisions.id, current.revisionId)))[0];
  assert.equal(await readFile(join(directory, stored.assets!["index.html"]), "utf8"), inputFiles("Second")[0].content);
  const restored = await req(`/api/sites/${current.id}/restore`, { revisionId: firstRevision, expectedVersion: 2 }); assert.equal(restored.status, 200);
  current = await restored.json(); assert.equal(current.version, 3); assert.equal(current.revisions.length, 3); assert(current.files[0].content.includes("First"));
  assert((await (await publicPage(current.id)).text()).includes("Second"));
  assert.equal((await req(`/s/${current.id}/v/${current.revisionId}/index.html`)).status, 404, "unpublished versions have no public assets");
});
test("native tools, shared commands, and bound chat use the same site services", async () => {
  const tools = createTableTools(dependencies(), undefined, org, uid);
  const options = { toolCallId: randomUUID(), messages: [] };
  const detail = await tools.get_site.execute!({ siteId: current.id, path: "app.js" }, options);
  assert.equal(detail.files.length, 1); assert.equal(detail.files[0].path, "app.js");
  const preview = await tools.open_preview.execute!({ kind: "site", siteId: current.id }, options);
  assert.equal(preview.siteId, current.id); assert.equal(preview.kind, "site");
  const dispatch = await req("/api/commands", { command: "getSite", input: { siteId: current.id, organizationId: foreign } });
  assert.equal(dispatch.status, 200); assert.equal((await dispatch.json()).result.id, current.id);
  const context = await resolveChatContext(dependencies(), { page: "sites", siteId: current.id }, { userId: uid, memberId: "", organizationId: org, kind: "human", role: "owner", name: "", email: "" });
  assert.equal(context.resourceKey, `site:${current.id}`); assert(context.system.includes(current.id));
  assert.equal((await req(`/api/sites/${current.id}/unpublish`, {})).status, 200);
  assert.equal((await req(`/s/${current.id}/`)).status, 404);
  const deleted = await req(`/api/sites/${current.id}`, undefined, "DELETE"); assert.equal(deleted.status, 200);
  assert.equal((await req(`/api/sites/${current.id}`)).status, 404);
  assert.equal((await db.select().from(sitePreviews).where(eq(sitePreviews.siteId, current.id))).length, 0);
});
