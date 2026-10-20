import { z } from "zod";
import type { ColumnDef, CellValue } from "./types.js";

export const BLOG_LIMITS = { articles: 20, assets: 60, assetBytes: 5 * 1024 * 1024, totalAssetBytes: 30 * 1024 * 1024, textBytes: 4 * 1024 * 1024, builds: 100, pageSize: 10 } as const;
const uuid = z.uuid(), version = z.number().int().positive();
export const blogMappingSchema = z.strictObject({
  title: uuid, slug: uuid.optional(), summary: uuid.optional(), author: uuid.optional(), date: uuid.optional(),
  cover: uuid.optional(), category: uuid.optional(), tags: uuid.optional(),
});
export const blogConfigSchema = z.strictObject({
  tableId: uuid, authorName: z.string().trim().max(100).default(""), description: z.string().trim().max(500), language: z.enum(["zh-CN", "en"]), mapping: blogMappingSchema,
  articles: z.array(z.strictObject({ rowId: uuid, imageIds: z.array(uuid).max(20), coverFileId: uuid.optional() })).max(BLOG_LIMITS.articles)
    .refine(items => new Set(items.map(item => item.rowId)).size === items.length, "Duplicate article"),
});
export type BlogConfig = z.infer<typeof blogConfigSchema>;
const write = { idempotencyKey: z.string().min(1).max(200) };
const site = { siteId: uuid };
const cas = { ...site, expectedVersion: version, expectedPublishedRevisionId: uuid.nullable(), ...write };
export const BLOG_SCHEMAS = {
  createBlog: z.strictObject({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(500).default(""), language: z.enum(["zh-CN", "en"]).default("zh-CN"), ...write }),
  startBlogArticle: z.strictObject({ ...site, expectedVersion: version, rowId: uuid.optional(), expectedRowVersion: version.optional(), title: z.string().trim().min(1).max(200), ...write }).refine(v => !v.rowId || v.expectedRowVersion !== undefined, "Existing article requires expectedRowVersion"),
  getBlogSources: z.strictObject({ tableId: uuid, afterId: uuid.optional(), limit: z.number().int().min(1).max(50).default(20) }),
  getBlog: z.strictObject({ ...site, revisionId: uuid.optional() }),
  saveBlog: z.strictObject({ siteId: uuid.optional(), expectedVersion: version.optional(), name: z.string().trim().min(1).max(100), config: blogConfigSchema, ...write })
    .refine(v => !v.siteId || v.expectedVersion !== undefined, "Existing blog requires expectedVersion"),
  buildBlog: z.strictObject({ ...site, expectedVersion: version, ...write }),
  publishBlog: z.strictObject({ ...cas, buildId: uuid, authorizationToken: z.string().max(100).optional() }),
  withdrawBlogArticle: z.strictObject({ ...cas, rowId: uuid, authorizationToken: z.string().max(100).optional() }),
  unpublishBlog: z.strictObject({ ...cas, authorizationToken: z.string().max(100).optional() }),
  restoreBlogRevision: z.strictObject({ ...site, expectedVersion: version, revisionId: uuid, ...write }),
  createBlogPreview: z.strictObject({ ...site, buildId: uuid, ...write }),
  revokeBlogPreviews: z.strictObject({ ...site, ...write }),
  authorizeBlogPublication: z.strictObject({ ...site, action: z.enum(["publishBlog", "withdrawBlogArticle", "unpublishBlog"]), expectedVersion: version, expectedPublishedRevisionId: uuid.nullable(), buildId: uuid.optional(), rowId: uuid.optional(), ...write }),
} as const;
export const BLOG_COMMANDS = Object.keys(BLOG_SCHEMAS) as (keyof typeof BLOG_SCHEMAS)[];
export type BlogCommand = keyof typeof BLOG_SCHEMAS;
export const BLOG_READ_COMMANDS: readonly BlogCommand[] = ["getBlog", "getBlogSources"];
export type BlogCommands = { [K in BlogCommand]: z.input<typeof BLOG_SCHEMAS[K]> };
export type BlogSource = { rowId: string; rowVersion: number; documentVersion: number | null; cells: Record<string, CellValue>; images: { id: string; name: string; mimeType: string; size: number }[]; covers: { id: string; columnId: string; name: string; size: number }[] };
export type BlogArticle = { rowId: string; rowVersion: number; documentId: string; documentVersion: number; slug: string; title: string; summary: string; author: string; authorPeople: { id: string; name: string }[]; date: string; category: string; tags: string[]; html: string; coverPath: string | null; assetPaths: string[] };
export type BlogAsset = { path: string; mimeType: string; size: number; hash: string; sourceId: string; sourceKind: "image" | "cover" };
/** Private provenance; never served as a public file. */
export type BlogManifest = { name: string; schemaVersion: 1; buildId: string; configVersion: number; configHash: string; hash: string; createdAt: string; articles: BlogArticle[]; assets: BlogAsset[] };
export type BlogDetail = { id: string; name: string; version: number; config: BlogConfig; revisionId: string; publishedRevisionId: string | null; publicUrl: string; manifest: BlogManifest | null; pendingChanges: boolean; publishedArticles: { rowId: string; slug: string; title: string }[]; revisions: { id: string; version: number; built: boolean; createdAt: string }[] };
export type BlogResults = {
  createBlog: BlogDetail;
  startBlogArticle: { tableId: string; rowId: string };
  getBlogSources: { columns: ColumnDef[]; items: BlogSource[]; nextAfterId: string | null };
  getBlog: BlogDetail; saveBlog: BlogDetail; buildBlog: BlogDetail; publishBlog: BlogDetail; withdrawBlogArticle: BlogDetail; unpublishBlog: BlogDetail; restoreBlogRevision: BlogDetail;
  createBlogPreview: { url: string; expiresAt: string }; revokeBlogPreviews: { revoked: true };
  authorizeBlogPublication: { authorizationToken: string; expiresAt: string };
};
