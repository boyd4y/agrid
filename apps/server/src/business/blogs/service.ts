import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { sha256 } from "@tabdo/core/crypto";
import { BLOG_SCHEMAS, BLOG_READ_COMMANDS, BLOG_LIMITS, type BlogCommand, type BlogResults, type BlogConfig, type BlogManifest, type BlogArticle, type BlogAsset, type DocumentContent, type DocumentNode, type BlogDetail, type BlogPermission } from "@tabdo/shared";
import { sites, siteRevisions, tables, columns, rows, member, user, recordDocuments, recordDocumentLinks, documentImages, fileObjects, blogAssetSnapshots, blogReceipts, blogPreviews, blogPublicationPermits } from "../db/schema.js";
import type { CommandDependencies } from "../dependencies.js";
import type { Transaction } from "../db/types.js";
import { inTransaction } from "../db/context.js";
import { requireWorkspace } from "../tenant/workspace.js";
import { resolveSiteKey, type SitePrincipal } from "../data-api/keys.js";
import { capabilities, siteMime } from "../sites/service.js";
import { renderDocumentHtml } from "../documents/renderer.js";
import { renderBlogFiles } from "./renderer.js";
import { blogStorageKey, collectBlogStorage } from "./storage.js";
import { BlogError } from "./errors.js";
import { isPublicBlogLink } from "./public-links.js";
export type BlogCaller = { kind: "member" | "native"; organizationId: string; actorId: string } | { kind: "key"; secret: string };
function fail(status: number, code: ConstructorParameters<typeof BlogError>[1], message: string): never { throw new BlogError(status, code, message); }
export function canonicalBlogValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalBlogValue).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalBlogValue(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value: unknown) => sha256(canonicalBlogValue(value));

const binary = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
function base64(bytes: Uint8Array) { let value = ""; for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(value); }
const imageMimes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
function validImage(bytes: Uint8Array, mime: string) {
  const start = (...v: number[]) => v.every((n, i) => bytes[i] === n);
  return mime === "image/png" ? start(137, 80, 78, 71, 13, 10, 26, 10) : mime === "image/jpeg" ? start(255, 216, 255) : mime === "image/gif" ? ["GIF87a", "GIF89a"].includes(new TextDecoder().decode(bytes.slice(0, 6))) : mime === "image/webp" && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}
const publicationCommands = ["publishBlog", "withdrawBlogArticle", "unpublishBlog"];
const intent = (command: string, input: Record<string, any>) => ({ command, siteId: input.siteId, expectedVersion: input.expectedVersion, expectedPublishedRevisionId: input.expectedPublishedRevisionId, buildId: input.buildId ?? null, rowId: input.rowId ?? null });

/** All transports share this boundary, including a savepoint when called inside a host transaction. */
export async function executeBlog<K extends BlogCommand>(deps: CommandDependencies, caller: BlogCaller, command: K, raw: unknown, transaction?: Transaction): Promise<BlogResults[K]> {
  if (!transaction) await collectBlogStorage(deps);
  const parsed = BLOG_SCHEMAS[command].safeParse(raw);
  if (!parsed.success) fail(400, "BAD_INPUT", parsed.error.issues[0]?.message ?? "Invalid blog input");
  const input = parsed.data as Record<string, any>;
  return inTransaction(deps, transaction, root => transaction ? root.transaction(run) : run(root)) as Promise<BlogResults[K]>;
  async function run(tx: Transaction): Promise<unknown> {
    let principal: SitePrincipal | undefined, organizationId: string, principalId: string, human = false, displayName = "", workspaceId: string;
    if (caller.kind === "key") { principal = await resolveSiteKey(tx, caller.secret, true); organizationId = principal.organizationId; principalId = `key:${principal.id}`; }
    else {
      organizationId = caller.organizationId; principalId = `user:${caller.actorId}`;
      const [current] = await tx.select({ kind: user.kind, name: user.name }).from(member).innerJoin(user, eq(member.userId, user.id)).where(and(eq(member.organizationId, organizationId), eq(member.userId, caller.actorId))).for("share");
      if (!current) fail(403, "FORBIDDEN", "Current membership is required"); human = caller.kind === "member" && current.kind === "human"; displayName = current.name;
    }
    let site: typeof sites.$inferSelect | undefined;
    if (input.siteId) {
      [site] = await tx.select().from(sites).where(and(eq(sites.id, input.siteId), eq(sites.organizationId, organizationId))).for("update");
      if (!site || site.kind !== "blog" || !site.blogConfig) fail(404, "NOT_FOUND", "Blog not found");
      workspaceId = site.workspaceId;
    } else if (principal) {
      const [table] = await tx.select().from(tables).where(and(eq(tables.id, input.config?.tableId ?? input.tableId), eq(tables.organizationId, organizationId)));
      if (!table) fail(404, "NOT_FOUND", "Content table not found"); workspaceId = table.workspaceId;
    } else workspaceId = (await requireWorkspace(deps, organizationId, tx)).id;
    if (!principal && workspaceId !== (await requireWorkspace(deps, organizationId, tx)).id) fail(404, "NOT_FOUND", "Blog not found");
    const tableId = site?.blogConfig?.tableId ?? input.config?.tableId ?? input.tableId;
    const permission: keyof Omit<BlogPermission, "tableId"> = BLOG_READ_COMMANDS.includes(command) ? "canRead" : command === "saveBlog" ? "canConfigure" : command === "restoreBlogRevision" ? "canRestore" : publicationCommands.includes(command) || command === "authorizeBlogPublication" ? "canPublish" : "canBuild";
    if (principal) {
      const grant = principal.blogPermissions.get(tableId);
      if (!grant) fail(404, "NOT_FOUND", "Blog not found");
      if (!grant[permission]) fail(403, "FORBIDDEN", "Blog operation is not granted");
    }
    if (command === "authorizeBlogPublication" && !human) fail(403, "FORBIDDEN", "Only a signed-in human can approve a publication");
    const publicUrl = (id: string) => new URL(`/s/${id}/`, capabilities(deps).publicOrigin).href;
    let receiptId: string | undefined;
    if (!BLOG_READ_COMMANDS.includes(command)) {
      const requestHash = await hash(input);
      const [reserved] = await tx.insert(blogReceipts).values({ workspaceId, principalId, command, key: input.idempotencyKey, requestHash }).onConflictDoNothing().returning();
      if (!reserved) {
        const [saved] = await tx.select().from(blogReceipts).where(and(eq(blogReceipts.workspaceId, workspaceId), eq(blogReceipts.principalId, principalId), eq(blogReceipts.command, command), eq(blogReceipts.key, input.idempotencyKey)));
        if (saved.requestHash !== requestHash) fail(409, "IDEMPOTENCY_MISMATCH", "Idempotency key belongs to another request");
        return saved.result;
      }
      receiptId = reserved.id;
    }
    const cas = (published = false) => {
      if (site!.version !== input.expectedVersion || published && site!.publishedRevisionId !== input.expectedPublishedRevisionId) fail(409, "VERSION_CONFLICT", "Blog changed; reload before continuing");
    };
    const approval = async () => {
      if (principal) return; // Dedicated canPublish grant, never inherited from table/document keys.
      if (!input.authorizationToken) fail(403, "PUBLICATION_APPROVAL_REQUIRED", "Confirm this publication in the blog editor first");
      const [permit] = await tx.delete(blogPublicationPermits).where(and(eq(blogPublicationPermits.tokenHash, await sha256(input.authorizationToken)), eq(blogPublicationPermits.siteId, site!.id), gt(blogPublicationPermits.expiresAt, deps.now()))).returning();
      if (!permit || permit.intentHash !== await hash(intent(command, input))) fail(403, "PUBLICATION_APPROVAL_REQUIRED", "Publication approval expired or does not match this operation");
    };
    const revision = async (id?: string) => {
      const [found] = await tx.select().from(siteRevisions).where(and(eq(siteRevisions.siteId, site!.id), id ? eq(siteRevisions.id, id) : eq(siteRevisions.version, site!.version)));
      if (!found) fail(404, "NOT_FOUND", "Blog revision not found"); return found;
    };
    const configColumns = async (config: BlogConfig) => {
      const [table] = await tx.select().from(tables).where(and(eq(tables.id, config.tableId), eq(tables.organizationId, organizationId), eq(tables.workspaceId, workspaceId))).for("share");
      if (!table) fail(404, "NOT_FOUND", "Content table not found");
      const fields = await tx.select().from(columns).where(eq(columns.tableId, table.id)).orderBy(asc(columns.id)).for("share");
      for (const [key, id] of Object.entries(config.mapping)) {
        const field = fields.find(f => f.id === id), types = key === "cover" ? ["file"] : key === "date" ? ["date", "text"] : key === "tags" ? ["multi_select", "select", "text"] : key === "category" ? ["select", "text"] : key === "author" ? ["text", "person"] : ["text"];
        if (!field || !types.includes(field.type)) fail(400, "BAD_INPUT", `Unsupported public field mapping: ${key}`);
      }
      return fields;
    };
    const configHash = async (config: BlogConfig) => hash({ config, columns: (await configColumns(config)).filter(f => Object.values(config.mapping).includes(f.id)).map(f => ({ id: f.id, type: f.type, config: f.config })) });
    const sourceVersionsMatch = async (manifest: BlogManifest) => {
      if (manifest.name !== site!.name || manifest.configHash !== await configHash(site!.blogConfig!)) return false;
      // Same lock order as document edits: row before document. Metadata and body stay fixed through publication.
      for (const article of [...manifest.articles].sort((a, b) => a.rowId.localeCompare(b.rowId))) {
        const [row] = await tx.select().from(rows).where(and(eq(rows.id, article.rowId), eq(rows.tableId, tableId))).for("share");
        const [doc] = await tx.select({ doc: recordDocuments }).from(recordDocumentLinks).innerJoin(recordDocuments, eq(recordDocuments.id, recordDocumentLinks.documentId)).where(and(eq(recordDocumentLinks.rowId, article.rowId), eq(recordDocumentLinks.tableId, tableId), eq(recordDocumentLinks.workspaceId, workspaceId))).for("share");
        if (!row || row.version !== article.rowVersion || !doc || doc.doc.id !== article.documentId || doc.doc.version !== article.documentVersion) return false;
        await tx.select({ id: recordDocuments.id }).from(recordDocuments).where(eq(recordDocuments.id, article.documentId)).for("share");
        if (article.authorPeople?.length) {
          const people = await tx.select({ id: user.id, name: user.name }).from(member).innerJoin(user, eq(user.id, member.userId)).where(and(eq(member.organizationId, organizationId), inArray(user.id, article.authorPeople.map(p => p.id)))).orderBy(asc(user.id)).for("share");
          if (canonicalBlogValue(people) !== canonicalBlogValue(article.authorPeople)) return false;
        }
      }
      for (const asset of manifest.assets) {
        if (asset.sourceKind === "image") {
          const [image] = await tx.select().from(documentImages).where(eq(documentImages.id, asset.sourceId)).for("share");
          if (!image || !manifest.articles.some(article => article.documentId === image.documentId) || image.size !== asset.size || image.mimeType !== asset.mimeType) return false;
        } else {
          const [file] = await tx.select().from(fileObjects).where(and(eq(fileObjects.id, asset.sourceId), eq(fileObjects.tableId, tableId), eq(fileObjects.workspaceId, workspaceId), eq(fileObjects.organizationId, organizationId))).for("share");
          if (!file || file.size !== asset.size || file.mimeType !== asset.mimeType) return false;
        }
      }
      return true;
    };
    const detail = async (selected?: typeof siteRevisions.$inferSelect): Promise<BlogDetail> => {
      const current = selected ?? await revision();
      const published = site!.publishedRevisionId ? await revision(site!.publishedRevisionId) : null;
      const history = await tx.select({ id: siteRevisions.id, version: siteRevisions.version, manifest: siteRevisions.blogManifest, createdAt: siteRevisions.createdAt }).from(siteRevisions).where(eq(siteRevisions.siteId, site!.id)).orderBy(desc(siteRevisions.version));
      let pendingChanges = !published || published.id !== current.id;
      if (!pendingChanges && published?.blogManifest) { try { pendingChanges = !await sourceVersionsMatch(published.blogManifest); } catch { pendingChanges = true; } }
      return { id: site!.id, name: site!.name, version: site!.version, config: selected?.blogConfig ?? site!.blogConfig!, revisionId: current.id, publishedRevisionId: site!.publishedRevisionId, publicUrl: publicUrl(site!.id), manifest: current.blogManifest, pendingChanges,
        publishedArticles: published?.blogManifest?.articles.map(({ rowId, slug, title }) => ({ rowId, slug, title })) ?? [], revisions: history.map(r => ({ id: r.id, version: r.version, built: !!r.manifest, createdAt: r.createdAt.toISOString() })) };
    };
    const insertRevision = async (files: typeof siteRevisions.$inferInsert.files, manifest: BlogManifest | null, config: BlogConfig, id = deps.uuid()) => {
      const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(siteRevisions).where(eq(siteRevisions.siteId, site!.id));
      if (command !== "withdrawBlogArticle" && count >= BLOG_LIMITS.builds) fail(400, "LIMIT_EXCEEDED", "Blog retains at most 100 revisions; create a new site to continue");
      [site] = await tx.update(sites).set({ version: site!.version + 1, updatedAt: deps.now() }).where(eq(sites.id, site!.id)).returning();
      const [saved] = await tx.insert(siteRevisions).values({ id, siteId: site!.id, version: site!.version, files, blogConfig: config, blogManifest: manifest, storageDriver: capabilities(deps).storageDriver, createdByUserId: caller.kind === "key" ? null : caller.actorId }).returning();
      return saved;
    };
    const materialize = async (build: typeof siteRevisions.$inferSelect) => {
      const caps = capabilities(deps), driver = build.storageDriver!, storage = caps.storage(driver), assets: Record<string, string> = {};
      if (build.assets) return;
      const ensureStored = async (key: string, bytes: Uint8Array, mime: string) => {
        let existing: Uint8Array | undefined;
        try { existing = new Uint8Array(await new Response(await storage.open(key)).arrayBuffer()); } catch { /* A missing object is written below. */ }
        if (existing) {
          if (existing.length === bytes.length && existing.every((v, i) => v === bytes[i])) return;
          // A killed local write can leave an incomplete exclusive-create object.
          await storage.remove(key);
        }
        await storage.put(key, bytes, mime);
      };
      // Partial uploads deliberately remain attached to the durable revision plan. Retry writes identical
      // bytes to identical keys; deletion cleans the complete plan, including interrupted uploads.
      try {
        for (const file of build.files) { const key = await blogStorageKey(build.id, file.path); await ensureStored(key, new TextEncoder().encode(file.content), siteMime(file.path)); assets[file.path] = key; }
        const binaries = await tx.select().from(blogAssetSnapshots).where(eq(blogAssetSnapshots.revisionId, build.id));
        for (const asset of build.blogManifest!.assets) {
          const snapshot = binaries.find(b => b.path === asset.path); if (!snapshot) fail(503, "STORAGE_UNAVAILABLE", "Binary snapshot missing");
          const key = await blogStorageKey(build.id, asset.path); await ensureStored(key, binary(snapshot.base64), asset.mimeType); assets[asset.path] = key;
        }
      } catch { fail(503, "STORAGE_UNAVAILABLE", "Blog upload incomplete; retry this build"); }
      await tx.update(siteRevisions).set({ assets }).where(eq(siteRevisions.id, build.id));
    };
    let result: unknown;
    switch (command) {
      case "getBlogSources": {
        const [table] = await tx.select().from(tables).where(and(eq(tables.id, tableId), eq(tables.workspaceId, workspaceId), eq(tables.organizationId, organizationId)));
        if (!table) fail(404, "NOT_FOUND", "Content table not found");
        const fields = await tx.select().from(columns).where(eq(columns.tableId, tableId)).orderBy(asc(columns.sortOrder));
        const records = await tx.select().from(rows).where(and(eq(rows.tableId, tableId), input.afterId ? gt(rows.id, input.afterId) : undefined)).orderBy(asc(rows.id)).limit(input.limit + 1);
        const items = [];
        for (const row of records.slice(0, input.limit)) {
          const [doc] = await tx.select({ id: recordDocuments.id, version: recordDocuments.version }).from(recordDocumentLinks).innerJoin(recordDocuments, eq(recordDocuments.id, recordDocumentLinks.documentId)).where(and(eq(recordDocumentLinks.rowId, row.id), eq(recordDocumentLinks.tableId, tableId)));
          const images = doc ? await tx.select({ id: documentImages.id, name: documentImages.name, mimeType: documentImages.mimeType, size: documentImages.size }).from(documentImages).where(eq(documentImages.documentId, doc.id)) : [];
          const fileIds = fields.filter(f => f.type === "file").flatMap(f => Array.isArray(row.cells[f.id]) ? row.cells[f.id] as string[] : []);
          const covers = fileIds.length ? await tx.select({ id: fileObjects.id, columnId: fileObjects.columnId, name: fileObjects.name, size: fileObjects.size }).from(fileObjects).where(and(eq(fileObjects.tableId, tableId), inArray(fileObjects.id, fileIds), inArray(fileObjects.mimeType, imageMimes))) : [];
          // Relations, person IDs and unmapped file IDs are private metadata; the editor uses names for people.
          const cells = { ...row.cells };
          for (const field of fields) if (["relation", "person", "file"].includes(field.type)) delete cells[field.id];
          items.push({ rowId: row.id, rowVersion: row.version, documentVersion: doc?.version ?? null, cells, images, covers });
        }
        result = { columns: fields, items, nextAfterId: records.length > input.limit ? items.at(-1)!.rowId : null }; break;
      }
      case "getBlog": result = await detail(input.revisionId ? await revision(input.revisionId) : undefined); break;
      case "saveBlog": {
        if (site) { cas(); if (input.config.tableId !== site.blogConfig!.tableId) fail(400, "BAD_INPUT", "Create another blog to change its content table"); }
        if (!input.config.authorName) input.config.authorName = displayName;
        if (!input.config.authorName || /@/.test(input.config.authorName)) fail(400, "BAD_INPUT", "Choose a public author name without an email address");
        await configColumns(input.config);
        if (!site) {
          [site] = await tx.insert(sites).values({ id: deps.uuid(), organizationId, workspaceId, kind: "blog", blogConfig: input.config, name: input.name }).returning();
          await tx.insert(siteRevisions).values({ id: deps.uuid(), siteId: site.id, version: site.version, files: [], blogConfig: input.config });
        } else {
          [site] = await tx.update(sites).set({ name: input.name, blogConfig: input.config }).where(eq(sites.id, site.id)).returning();
          await insertRevision([], null, input.config);
        }
        result = await detail(); break;
      }
      case "buildBlog": {
        cas(); const config = site!.blogConfig!, fields = await configColumns(config), buildId = deps.uuid();
        const assets: BlogAsset[] = [], snapshots = new Map<string, string>(), articles: BlogArticle[] = []; let bytesTotal = 0;
        const slugs = new Set<string>();
        const copyAsset = async (source: { id: string; mimeType: string; size: number; storageDriver: string; storageKey: string }, kind: "image" | "cover") => {
          if (!imageMimes.includes(source.mimeType) || source.size > BLOG_LIMITS.assetBytes) fail(400, "BAD_INPUT", "Only PNG/JPEG/WebP/GIF up to 5 MiB can be published");
          let bytes: Uint8Array;
          try { bytes = new Uint8Array(await new Response(await capabilities(deps).storage(source.storageDriver).open(source.storageKey)).arrayBuffer()); } catch { fail(503, "STORAGE_UNAVAILABLE", "Source image unavailable"); }
          if (bytes!.length !== source.size || !validImage(bytes!, source.mimeType)) fail(400, "BAD_INPUT", "Image signature or size mismatch");
          const encoded = base64(bytes!), digest = await sha256(encoded), ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[source.mimeType];
          const path = `assets/${digest}.${ext}`;
          if (!snapshots.has(path)) { bytesTotal += bytes!.length; snapshots.set(path, encoded); assets.push({ path, mimeType: source.mimeType, size: source.size, hash: digest, sourceId: source.id, sourceKind: kind }); }
          if (assets.length > BLOG_LIMITS.assets || bytesTotal > BLOG_LIMITS.totalAssetBytes) fail(400, "LIMIT_EXCEEDED", "Blog image budget exceeded");
          return path;
        };
        for (const selection of [...config.articles].sort((a, b) => a.rowId.localeCompare(b.rowId))) {
          const [row] = await tx.select().from(rows).where(and(eq(rows.id, selection.rowId), eq(rows.tableId, tableId))).for("share");
          if (!row) fail(404, "NOT_FOUND", "Selected article no longer exists");
          const [linked] = await tx.select({ id: recordDocumentLinks.documentId }).from(recordDocumentLinks).where(and(eq(recordDocumentLinks.rowId, row.id), eq(recordDocumentLinks.tableId, tableId), eq(recordDocumentLinks.workspaceId, workspaceId)));
          if (!linked) fail(400, "BAD_INPUT", "Enable a document for every selected article");
          const [doc] = await tx.select().from(recordDocuments).where(eq(recordDocuments.id, linked.id)).for("share");
          const text = (key: keyof BlogConfig["mapping"], max: number) => { const id = config.mapping[key], v = id ? row.cells[id] : null; return typeof v === "string" ? v.trim().slice(0, max) : ""; };
          const title = text("title", 200), slug = text("slug", 100).toLowerCase();
          if (!title || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slugs.has(slug)) fail(400, "BAD_INPUT", "Articles need a title and unique lowercase URL slug"); slugs.add(slug);
          const label = (key: "category" | "tags") => {
            const id = config.mapping[key], field = fields.find(f => f.id === id), cell = id ? row.cells[id] : null;
            const values = Array.isArray(cell) ? cell : typeof cell === "string" ? [cell] : [];
            return values.slice(0, 10).map(v => field?.config.options?.find(o => o.id === v)?.label ?? v).map(v => v.slice(0, 80)).filter(Boolean);
          };
          let author = text("author", 100) || config.authorName, authorPeople: { id: string; name: string }[] = [];
          if (fields.find(f => f.id === config.mapping.author)?.type === "person") {
            const v = row.cells[config.mapping.author!], ids = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
            const people = ids.length ? await tx.select({ id: user.id, name: user.name }).from(member).innerJoin(user, eq(user.id, member.userId)).where(and(eq(member.organizationId, organizationId), inArray(user.id, ids))).orderBy(asc(user.id)).for("share") : [];
            authorPeople = people;
            author = people.map(p => p.name).join(", ").slice(0, 100) || config.authorName;
          }
          if (/@/.test(author)) fail(400, "BAD_INPUT", "Choose a public author name without an email address");
          let date = text("date", 100); if (date) { if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(date) || !Number.isFinite(Date.parse(date))) fail(400, "BAD_INPUT", "Invalid publication date"); date = date.slice(0, 10); }
          const approved = new Set(selection.imageIds), imagePaths = new Map<string, string>();
          const selectedImages = approved.size ? await tx.select().from(documentImages).where(and(eq(documentImages.documentId, doc.id), inArray(documentImages.id, [...approved]))).for("share") : [];
          if (selectedImages.length !== approved.size) fail(400, "BAD_INPUT", "Selected image does not belong to this document");
          const publicMarks = (node: DocumentNode) => node.marks?.filter(mark => {
            if (mark.type !== "link") return true;
            return isPublicBlogLink(mark.attrs.href);
          });
          const selectedContent = (node: DocumentNode): DocumentNode[] => {
            if (node.type === "image" && !approved.has(String(node.attrs!.fileId))) return [];
            const children = node.content?.flatMap(selectedContent);
            if (children && !children.length && ["blockquote", "bulletList", "orderedList", "listItem"].includes(node.type)) return [];
            return [{ ...node, ...(node.marks ? { marks: publicMarks(node) } : {}), ...(children ? { content: children } : {}) }];
          };
          const content = { type: "doc", content: doc.content.content.flatMap(selectedContent) } as DocumentContent;
          if (!content.content.length) content.content.push({ type: "paragraph" });
          // Only images actually referenced by the selected body are copied.
          let html = renderDocumentHtml(content);
          for (const image of selectedImages) if (html.includes(`document-assets/${image.id}`)) imagePaths.set(image.id, await copyAsset(image, "image"));
          for (const [id, path] of imagePaths) html = html.replaceAll(`document-assets/${id}`, path);
          let coverPath: string | null = null;
          if (selection.coverFileId) {
            const values = config.mapping.cover ? row.cells[config.mapping.cover] : null;
            if (!Array.isArray(values) || !values.includes(selection.coverFileId)) fail(400, "BAD_INPUT", "Cover must be explicitly selected from the mapped row file field");
            const [cover] = await tx.select().from(fileObjects).where(and(eq(fileObjects.id, selection.coverFileId), eq(fileObjects.tableId, tableId), eq(fileObjects.columnId, config.mapping.cover!), eq(fileObjects.workspaceId, workspaceId), eq(fileObjects.organizationId, organizationId))).for("share");
            if (!cover) fail(404, "NOT_FOUND", "Cover file not found"); coverPath = await copyAsset(cover, "cover");
          }
          articles.push({ rowId: row.id, rowVersion: row.version, documentId: doc.id, documentVersion: doc.version, title, slug, summary: text("summary", 500), author, authorPeople, date, category: label("category")[0] ?? "", tags: label("tags"), html, coverPath, assetPaths: [...new Set([...imagePaths.values(), ...(coverPath ? [coverPath] : [])])] });
        }
        const manifest: BlogManifest = { name: site!.name, schemaVersion: 1, buildId, configVersion: site!.version, configHash: await configHash(config), createdAt: deps.now().toISOString(), hash: "", articles, assets };
        const files = renderBlogFiles(site!.name, config, manifest, publicUrl(site!.id));
        if (files.reduce((n, f) => n + new TextEncoder().encode(f.content).length, 0) > BLOG_LIMITS.textBytes) fail(400, "LIMIT_EXCEEDED", "Generated HTML exceeds 4 MiB");
        manifest.hash = await hash({ manifest, files });
        await insertRevision(files, manifest, config, buildId);
        if (snapshots.size) await tx.insert(blogAssetSnapshots).values([...snapshots].map(([path, base64]) => ({ revisionId: buildId, path, base64 })));
        result = await detail(); break;
      }
      case "publishBlog": {
        cas(true); await approval(); const build = await revision(input.buildId);
        if (!build.blogManifest || build.version !== site!.version) fail(409, "VERSION_CONFLICT", "Build the current draft before publishing");
        if (!await sourceVersionsMatch(build.blogManifest)) fail(409, "SOURCE_CHANGED", "Source content changed; rebuild before publishing");
        await materialize(build);
        [site] = await tx.update(sites).set({ publishedRevisionId: build.id, updatedAt: deps.now() }).where(eq(sites.id, site!.id)).returning();
        await tx.delete(blogPreviews).where(eq(blogPreviews.siteId, site!.id)); result = await detail(); break;
      }
      case "withdrawBlogArticle": {
        cas(true); await approval(); if (!site!.publishedRevisionId) fail(404, "NOT_FOUND", "Blog is not published");
        const published = await revision(site!.publishedRevisionId), old = published.blogManifest!;
        if (!old.articles.some(a => a.rowId === input.rowId)) fail(404, "NOT_FOUND", "Article is not published");
        const config = { ...site!.blogConfig!, articles: site!.blogConfig!.articles.filter(a => a.rowId !== input.rowId) };
        const id = deps.uuid(), articles = old.articles.filter(a => a.rowId !== input.rowId), paths = new Set(articles.flatMap(a => a.assetPaths));
        const manifest: BlogManifest = { ...old, buildId: id, configVersion: site!.version, createdAt: deps.now().toISOString(), articles, assets: old.assets.filter(a => paths.has(a.path)), hash: "" };
        // Withdraw uses only already published copies; unavailable/deleted sources cannot prevent recall.
        const files = renderBlogFiles(old.name, published.blogConfig!, manifest, publicUrl(site!.id));
        manifest.hash = await hash({ manifest, files });
        [site] = await tx.update(sites).set({ blogConfig: config }).where(eq(sites.id, site!.id)).returning();
        const next = await insertRevision(files, manifest, config, id);
        const snapshots = await tx.select().from(blogAssetSnapshots).where(eq(blogAssetSnapshots.revisionId, published.id));
        const retained = snapshots.filter(a => paths.has(a.path));
        if (retained.length) await tx.insert(blogAssetSnapshots).values(retained.map(a => ({ ...a, revisionId: id })));
        const reusedAssets = Object.fromEntries(Object.entries(published.assets ?? {}).filter(([path]) => paths.has(path)));
        await tx.update(siteRevisions).set({ assets: reusedAssets, storageDriver: published.storageDriver }).where(eq(siteRevisions.id, next.id));
        [site] = await tx.update(sites).set({ publishedRevisionId: id, updatedAt: deps.now() }).where(eq(sites.id, site!.id)).returning();
        await tx.delete(blogPreviews).where(eq(blogPreviews.siteId, site!.id)); result = await detail(); break;
      }
      case "unpublishBlog": {
        cas(true); await approval(); [site] = await tx.update(sites).set({ publishedRevisionId: null, updatedAt: deps.now() }).where(eq(sites.id, site!.id)).returning();
        await tx.delete(blogPreviews).where(eq(blogPreviews.siteId, site!.id)); result = await detail(); break;
      }
      case "restoreBlogRevision": {
        cas(); const old = await revision(input.revisionId); if (!old.blogConfig) fail(404, "NOT_FOUND", "Blog configuration not found");
        [site] = await tx.update(sites).set({ blogConfig: old.blogConfig }).where(eq(sites.id, site!.id)).returning(); await insertRevision([], null, old.blogConfig); result = await detail(); break;
      }
      case "createBlogPreview": {
        const build = await revision(input.buildId); if (!build.blogManifest || build.version !== site!.version) fail(409, "VERSION_CONFLICT", "Build the current draft first");
        if (!await sourceVersionsMatch(build.blogManifest)) fail(409, "SOURCE_CHANGED", "Source changed; rebuild before sharing a preview");
        const token = deps.uuid() + deps.uuid(), expiresAt = new Date(deps.now().getTime() + 10 * 60_000);
        await tx.delete(blogPreviews).where(eq(blogPreviews.siteId, site!.id));
        await tx.insert(blogPreviews).values({ token, siteId: site!.id, revisionId: build.id, expiresAt });
        result = { url: new URL(`/blog-preview/${token}/`, capabilities(deps).publicOrigin).href, expiresAt: expiresAt.toISOString() }; break;
      }
      case "revokeBlogPreviews": await tx.delete(blogPreviews).where(eq(blogPreviews.siteId, site!.id)); result = { revoked: true }; break;
      case "authorizeBlogPublication": {
        cas(true); const token = deps.uuid() + deps.uuid(), expiresAt = new Date(deps.now().getTime() + 5 * 60_000);
        await tx.insert(blogPublicationPermits).values({ tokenHash: await sha256(token), siteId: site!.id, intentHash: await hash(intent(input.action, input)), expiresAt });
        result = { authorizationToken: token, expiresAt: expiresAt.toISOString() }; break;
      }
    }
    if (receiptId) await tx.update(blogReceipts).set({ result }).where(eq(blogReceipts.id, receiptId));
    return result;
  }
}
export function memberBlogCommand<K extends BlogCommand>(deps: CommandDependencies, command: K, input: Record<string, unknown> & { organizationId?: string; actorId?: string }, tx?: Transaction) {
  const { organizationId, actorId, ...raw } = input;
  if (!organizationId || !actorId) fail(403, "FORBIDDEN", "Current membership is required");
  return executeBlog(deps, { kind: "member", organizationId, actorId }, command, raw, tx);
}
