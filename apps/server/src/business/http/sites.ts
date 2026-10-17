import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { SITE_FILES_SCHEMA, SITE_SAVE_SCHEMA } from "@tabdo/shared";
import { createRequestRoute, requireActorOrg, type RequestScopeResolver } from "./request.js";
import * as service from "../sites/service.js";
import { sites, siteRevisions, sitePreviews, blogPreviews, blogAssetSnapshots } from "../db/schema.js";

export function createSitesRoute(acquire: RequestScopeResolver) {
  const route = createRequestRoute(acquire);
  route.use("*", bodyLimit({ maxSize: 3 * 1024 * 1024 }));
  route.use("*", async(c, next) => { c.header("Cache-Control", "no-store"); await next(); });
  route.get("/config", c => {
    const scope = requireActorOrg(c); if (!scope.ok) return c.json({ error: scope.error }, scope.status);
    return c.json(service.getSiteConfig(c.get("resources").commands));
  });
  route.get("/", async c => {
    const scope = requireActorOrg(c); if (!scope.ok) return c.json({ error: scope.error }, scope.status);
    return c.json(await service.listSites(c.get("resources").commands, { organizationId: scope.organizationId }));
  });
  route.get("/:id", async c => {
    const scope = requireActorOrg(c); if (!scope.ok) return c.json({ error: scope.error }, scope.status);
    return c.json(await service.getSite(c.get("resources").commands, { siteId: c.req.param("id"), revisionId: c.req.query("revisionId"), organizationId: scope.organizationId }));
  });
  route.post("/", async c => {
    const scope = requireActorOrg(c); if (!scope.ok) return c.json({ error: scope.error }, scope.status);
    const input = SITE_SAVE_SCHEMA.parse(await c.req.json());
    return c.json(await service.saveSite(c.get("resources").commands, { ...input, organizationId: scope.organizationId, actorId: scope.actor.userId }), input.siteId ? 200 : 201);
  });
  route.post("/:id/preview", async c => {
    const scope = requireActorOrg(c); if (!scope.ok) return c.json({ error: scope.error }, scope.status);
    const input = z.strictObject({ files: SITE_FILES_SCHEMA, token: z.string().max(100).optional(), generation: z.number().int().positive().optional() }).parse(await c.req.json());
    return c.json(await service.previewSite(c.get("resources").commands, { ...input, siteId: c.req.param("id"), organizationId: scope.organizationId }));
  });
  for (const action of ["publish", "restore"] as const) route.post(`/:id/${action}`, async c => {
    const scope = requireActorOrg(c); if (!scope.ok) return c.json({ error: scope.error }, scope.status);
    const input = z.strictObject({ revisionId: z.uuid(), expectedVersion: z.number().int().positive().optional() }).parse(await c.req.json());
    const deps = c.get("resources").commands, base = { ...input, organizationId: scope.organizationId, actorId: scope.actor.userId, siteId: c.req.param("id") };
    return c.json(action === "publish" ? await service.publishSite(deps, base) : await service.restoreSiteRevision(deps, { ...base, expectedVersion: z.number().int().positive().parse(input.expectedVersion) }));
  });
  route.post("/:id/unpublish", async c => {
    const scope = requireActorOrg(c); if (!scope.ok) return c.json({ error: scope.error }, scope.status);
    return c.json(await service.unpublishSite(c.get("resources").commands, { siteId: c.req.param("id"), organizationId: scope.organizationId }));
  });
  route.delete("/:id", async c => {
    const scope = requireActorOrg(c); if (!scope.ok) return c.json({ error: scope.error }, scope.status);
    return c.json(await service.deleteSite(c.get("resources").commands, { siteId: c.req.param("id"), organizationId: scope.organizationId }));
  });
  return route;
}

/** Untrusted documents always get an opaque browser origin, including top-level navigation. */
export function createSiteAssetsRoute(acquire: RequestScopeResolver) {
  const route = new Hono();
  route.get("/blog-preview/:token/*", c => serve(c.req.raw, c.req.param("token"), true, true));
  route.get("/site-preview/:token/*", c => serve(c.req.raw, c.req.param("token"), true));
  route.get("/s/:id/*", c => serve(c.req.raw, c.req.param("id"), false));
  async function serve(request: Request, id: string, preview: boolean, blogPreview = false) {
    const scope = await acquire(request);
    try {
      const deps = scope.commands, caps = service.capabilities(deps), url = new URL(request.url);
      const prefix = preview ? `/${blogPreview ? "blog-preview" : "site-preview"}/${id}/` : `/s/${id}/`;
      let path: string;
      try { path = decodeURIComponent(url.pathname.slice(prefix.length)); } catch { return new Response("Not found", { status: 404 }); }
      if (!path || path.endsWith("/")) path += "index.html";
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(path) || path.split("/").some(part => !part || part === "." || part === "..")) return new Response("Not found", { status: 404 });
      let body: string | Uint8Array | ReadableStream<Uint8Array>, mime: string | undefined, isBlog = blogPreview;
      if (blogPreview) {
        const [record] = await deps.database.select().from(blogPreviews).where(and(eq(blogPreviews.token, id), gt(blogPreviews.expiresAt, deps.now())));
        if (!record) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
        const [revision] = await deps.database.select().from(siteRevisions).where(eq(siteRevisions.id, record.revisionId));
        const file = revision?.files.find(f => f.path === path);
        if (file) body = file.content;
        else {
          const asset = revision?.blogManifest?.assets.find(a => a.path === path);
          const [snapshot] = asset ? await deps.database.select().from(blogAssetSnapshots).where(and(eq(blogAssetSnapshots.revisionId, record.revisionId), eq(blogAssetSnapshots.path, path))) : [];
          if (!asset || !snapshot) return new Response("Not found", { status: 404 });
          body = Uint8Array.from(atob(snapshot.base64), c => c.charCodeAt(0)); mime = asset.mimeType;
        }
      } else if (preview) {
        const [record] = await deps.database.select().from(sitePreviews).where(and(eq(sitePreviews.token, id), gt(sitePreviews.expiresAt, deps.now())));
        const file = record?.files.find(file => file.path === path);
        if (!file) return new Response("Not found", { status: 404 }); body = file.content;
      } else {
        if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
        const [site] = await deps.database.select().from(sites).where(eq(sites.id, id));
        isBlog = site?.kind === "blog";
        if (!site?.publishedRevisionId) return new Response("Not found", { status: 404 });
        const versionPath = path.match(/^v\/([a-f0-9-]{36})\/(.+)$/);
        if (!versionPath) return new Response(null, { status: 302, headers: { Location: new URL(`/s/${id}/v/${site.publishedRevisionId}/${path}`, caps.publicOrigin).href, "Cache-Control": "no-store" } });
        const [revision] = await deps.database.select().from(siteRevisions).where(and(eq(siteRevisions.siteId, id), eq(siteRevisions.id, versionPath[1])));
        path = versionPath[2];
        // Blog recall invalidates every historical path; code sites retain their historical URLs.
        if (site.kind === "blog" && revision?.id !== site.publishedRevisionId) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
        const file = site.kind === "blog" ? revision?.files.find(f => f.path === path) : undefined;
        if (file) body = file.content;
        else {
          const key = revision?.assets?.[path], driver = revision?.storageDriver;
          if (!key || !driver) return new Response("Not found", { status: 404 });
          if (site.kind === "blog") { const asset = revision?.blogManifest?.assets.find(a => a.path === path); if (!asset) return new Response("Not found", { status: 404 }); mime = asset.mimeType; }
          body = await caps.storage(driver).open(key);
        }
      }
      const csp = ["sandbox allow-scripts allow-forms allow-downloads", "default-src 'none'",
        `script-src 'unsafe-inline' https: ${url.origin} ${new URL(caps.sdkUrl).origin}`, `style-src 'unsafe-inline' https: ${url.origin}`,
        `img-src https: data: blob: ${url.origin}`, `font-src https: data: ${url.origin}`,
        `connect-src ${caps.apiOrigin} ${url.origin}`, "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join("; ");
      const blogCsp = ["sandbox", "default-src 'none'", "script-src 'none'", `style-src 'unsafe-inline' ${url.origin}`, `img-src ${url.origin}`, "connect-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join("; ");
      return new Response(body as BodyInit, { headers: { "Content-Type": mime ?? service.siteMime(path), "Content-Security-Policy": isBlog ? blogCsp : csp,
        "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin", "Cache-Control": "no-store",
        ...(preview ? { "X-Robots-Tag": "noindex, nofollow, noarchive" } : {}),
        "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Permissions-Policy": "camera=(), microphone=(), geolocation=()" } });
    } catch { return new Response("Site unavailable", { status: 503 }); }
    finally { await scope.close(); }
  }
  return route;
}
