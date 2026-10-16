import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { SITE_FILES_SCHEMA, SITE_SAVE_SCHEMA, type SiteConfig, type SiteDetail, type SiteSummary } from "@tabdo/shared";
import { sites, siteRevisions, sitePreviews } from "../db/schema.js";
import type { CommandDependencies } from "../dependencies.js";
import type { Transaction } from "../db/types.js";
import { inTransaction } from "../db/context.js";
import { ServiceError } from "../errors.js";

const uuid = (value: unknown) => z.uuid().parse(value);
type Scope = { organizationId?: string; actorId?: string };
function org(input: Scope) { if (!input.organizationId) throw new ServiceError(401, { message: "Workspace required" }); return input.organizationId; }
export function capabilities(deps: CommandDependencies) {
  if (!deps.sites) throw new ServiceError(503, { message: "Site storage is not configured" }); return deps.sites;
}
export function siteMime(path: string) {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return ({ html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8", svg: "image/svg+xml", txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8" } as Record<string,string>)[extension ?? ""] ?? "application/octet-stream";
}
export function getSiteConfig(deps: CommandDependencies): SiteConfig {
  return { sdkUrl: capabilities(deps).sdkUrl };
}
async function owned(deps: CommandDependencies, input: Scope & { siteId: string }, tx?: Transaction, lock = false) {
  const query = (tx ?? deps.database).select().from(sites).where(and(eq(sites.id, uuid(input.siteId)), eq(sites.organizationId, org(input))));
  const [site] = await (lock ? query.for("update") : query);
  if (!site) throw new ServiceError(404, { message: "Site not found" }); return site;
}
function summary(deps: CommandDependencies, site: typeof sites.$inferSelect, publishedVersion: number | null): SiteSummary {
  return { id: site.id, name: site.name, version: site.version, publishedRevisionId: site.publishedRevisionId, publishedVersion,
    publicUrl: new URL(`/s/${site.id}/`, capabilities(deps).publicOrigin).href, updatedAt: site.updatedAt.toISOString() };
}
export async function listSites(deps: CommandDependencies, input: Scope, tx?: Transaction) {
  const records = await (tx ?? deps.database).select({ site: sites, publishedVersion: siteRevisions.version }).from(sites)
    .leftJoin(siteRevisions, eq(sites.publishedRevisionId, siteRevisions.id)).where(eq(sites.organizationId, org(input))).orderBy(desc(sites.updatedAt), desc(sites.id));
  return records.map(record => summary(deps, record.site, record.publishedVersion));
}
export async function getSite(deps: CommandDependencies, input: Scope & { siteId: string; revisionId?: string; path?: string }, tx?: Transaction): Promise<SiteDetail> {
  const site = await owned(deps, input, tx), db = tx ?? deps.database;
  const revisionQuery = db.select().from(siteRevisions).where(and(eq(siteRevisions.siteId, site.id), input.revisionId ? eq(siteRevisions.id, uuid(input.revisionId)) : eq(siteRevisions.version, site.version)));
  const [revision] = await revisionQuery;
  if (!revision) throw new ServiceError(404, { message: "Site version not found" });
  const revisions = await db.select({ id: siteRevisions.id, version: siteRevisions.version, createdAt: siteRevisions.createdAt, createdByUserId: siteRevisions.createdByUserId }).from(siteRevisions).where(eq(siteRevisions.siteId, site.id)).orderBy(desc(siteRevisions.version));
  return { ...summary(deps, site, revisions.find(item => item.id === site.publishedRevisionId)?.version ?? null),
    files: input.path ? revision.files.filter(file => file.path === input.path) : revision.files, revisionId: revision.id,
    revisions: revisions.map(item => ({ ...item, createdAt: item.createdAt.toISOString() })) };
}
export async function saveSite(deps: CommandDependencies, raw: Scope & Record<string, unknown>, transaction?: Transaction) {
  const { organizationId: _org, actorId: _actor, ...value } = raw;
  const input = SITE_SAVE_SCHEMA.parse(value), organizationId = org(raw), files = input.files;
  return inTransaction(deps, transaction, async tx => {
    let site;
    if (input.siteId) {
      site = await owned(deps, { siteId: input.siteId, organizationId }, tx, true);
      if (site.version !== input.expectedVersion) throw new ServiceError(409, { message: "Site version conflict; reload before saving" });
      [site] = await tx.update(sites).set({ name: input.name, version: site.version + 1, updatedAt: deps.now() }).where(eq(sites.id, site.id)).returning();
    } else [site] = await tx.insert(sites).values({ id: deps.uuid(), organizationId, name: input.name }).returning();
    await tx.insert(siteRevisions).values({ id: deps.uuid(), siteId: site.id, version: site.version, files, createdByUserId: raw.actorId ?? null });
    return getSite(deps, { siteId: site.id, organizationId }, tx);
  });
}
export async function restoreSiteRevision(deps: CommandDependencies, input: Scope & { siteId: string; revisionId: string; expectedVersion: number }, transaction?: Transaction) {
  return inTransaction(deps, transaction, async tx => {
    const revision = await getSite(deps, input, tx);
    return saveSite(deps, { organizationId: org(input), actorId: input.actorId, siteId: input.siteId, name: revision.name, files: revision.files, expectedVersion: z.number().int().positive().parse(input.expectedVersion) }, tx);
  });
}
export async function publishSite(deps: CommandDependencies, input: Scope & { siteId: string; revisionId: string }, transaction?: Transaction) {
  const caps = capabilities(deps);
  return inTransaction(deps, transaction, async tx => {
    const site = await owned(deps, input, tx, true);
    const [revision] = await tx.select().from(siteRevisions).where(and(eq(siteRevisions.siteId, site.id), eq(siteRevisions.id, uuid(input.revisionId)))).for("update");
    if (!revision) throw new ServiceError(404, { message: "Site version not found" });
    if (!revision.assets) {
      const storage = caps.storage(caps.storageDriver), assets: Record<string,string> = {}, uploaded: string[] = [];
      try {
        for (const file of revision.files) {
          const id = deps.uuid(), key = `${id.slice(0, 2)}/${id}`;
          await storage.put(key, new TextEncoder().encode(file.content), siteMime(file.path)); uploaded.push(key); assets[file.path] = key;
        }
        await tx.update(siteRevisions).set({ assets, storageDriver: caps.storageDriver }).where(eq(siteRevisions.id, revision.id));
      } catch (error) { await Promise.allSettled(uploaded.map(key => storage.remove(key))); throw error; }
    }
    await tx.update(sites).set({ publishedRevisionId: revision.id, updatedAt: deps.now() }).where(eq(sites.id, site.id));
    return getSite(deps, { ...input, revisionId: undefined }, tx);
  });
}
export async function unpublishSite(deps: CommandDependencies, input: Scope & { siteId: string }, transaction?: Transaction) {
  return inTransaction(deps, transaction, async tx => {
    const site = await owned(deps, input, tx, true);
    await tx.update(sites).set({ publishedRevisionId: null, updatedAt: deps.now() }).where(eq(sites.id, site.id));
    return getSite(deps, input, tx);
  });
}
export async function deleteSite(deps: CommandDependencies, input: Scope & { siteId: string }, transaction?: Transaction) {
  // Deletion makes every public URL inaccessible before removing immutable objects.
  return inTransaction(deps, transaction, async tx => {
    const site = await owned(deps, input, tx, true);
    const revisions = await tx.select({ assets: siteRevisions.assets, driver: siteRevisions.storageDriver }).from(siteRevisions).where(eq(siteRevisions.siteId, site.id));
    const cleanup = async () => {
      const caps = capabilities(deps);
      await Promise.allSettled(revisions.flatMap(revision => revision.driver ? Object.values(revision.assets ?? {}).map(key => caps.storage(revision.driver!).remove(key)) : []));
    };
    await tx.update(sites).set({ publishedRevisionId: null }).where(eq(sites.id, site.id));
    await tx.delete(sites).where(eq(sites.id, site.id));
    deps.afterCommit?.(tx, `site-delete:${site.id}`, () => { void cleanup(); });
    return { id: site.id };
  });
}
export async function previewSite(deps: CommandDependencies, input: Scope & { siteId: string; files: unknown; token?: string; generation?: number }) {
  await owned(deps, input); const files = SITE_FILES_SCHEMA.parse(input.files), now = deps.now();
  await deps.database.delete(sitePreviews).where(and(eq(sitePreviews.siteId, input.siteId), lt(sitePreviews.expiresAt, now)));
  const expiresAt = new Date(now.getTime() + 2 * 3600_000), generation = input.generation ?? 1;
  const [preview] = input.token
    ? await deps.database.update(sitePreviews).set({ files, expiresAt, generation }).where(and(eq(sitePreviews.siteId, input.siteId), eq(sitePreviews.token, input.token), lt(sitePreviews.generation, generation))).returning()
    : await deps.database.insert(sitePreviews).values({ id: deps.uuid(), siteId: input.siteId, token: deps.uuid() + deps.uuid(), files, expiresAt, generation }).returning();
  if (!preview) throw new ServiceError(404, { message: "Preview expired; open a new preview" });
  return { token: preview.token, url: new URL(`/site-preview/${preview.token}/`, capabilities(deps).publicOrigin).href };
}
