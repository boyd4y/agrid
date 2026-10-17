import { z } from "zod";
import type { ColumnDef, CellValue } from "./types.js";

export const BLOG_LIMITS = { articles: 20, assets: 60, assetBytes: 5 * 1024 * 1024, totalAssetBytes: 30 * 1024 * 1024, textBytes: 4 * 1024 * 1024, builds: 100, pageSize: 10 } as const;
const uuid = z.uuid(), version = z.number().int().positive();
export const blogMappingSchema = z.strictObject({
  title: uuid, slug: uuid, summary: uuid.optional(), author: uuid.optional(), date: uuid.optional(),
  cover: uuid.optional(), category: uuid.optional(), tags: uuid.optional(),
});
export const blogConfigSchema = z.strictObject({
  tableId: uuid, authorName: z.string().trim().max(100).default(""), description: z.string().trim().max(500), language: z.enum(["zh-CN", "en"]), mapping: blogMappingSchema,
  articles: z.array(z.strictObject({ rowId: uuid, imageIds: z.array(uuid).max(20), coverFileId: uuid.optional() })).max(BLOG_LIMITS.articles)
    .refine(items => new Set(items.map(item => item.rowId)).size === items.length, "Duplicate article"),
});
export type BlogConfig = z.infer<typeof blogConfigSchema>;
export const blogPermissionSchema = z.strictObject({ tableId: uuid, canRead: z.boolean(), canConfigure: z.boolean(), canBuild: z.boolean(), canPublish: z.boolean(), canRestore: z.boolean() })
  .refine(p => p.canRead || p.canConfigure || p.canBuild || p.canPublish || p.canRestore);
export type BlogPermission = z.infer<typeof blogPermissionSchema>;
const write = { idempotencyKey: z.string().min(1).max(200) };
const site = { siteId: uuid };
const cas = { ...site, expectedVersion: version, expectedPublishedRevisionId: uuid.nullable(), ...write };
export const BLOG_SCHEMAS = {
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
  getBlogSources: { columns: ColumnDef[]; items: BlogSource[]; nextAfterId: string | null };
  getBlog: BlogDetail; saveBlog: BlogDetail; buildBlog: BlogDetail; publishBlog: BlogDetail; withdrawBlogArticle: BlogDetail; unpublishBlog: BlogDetail; restoreBlogRevision: BlogDetail;
  createBlogPreview: { url: string; expiresAt: string }; revokeBlogPreviews: { revoked: true };
  authorizeBlogPublication: { authorizationToken: string; expiresAt: string };
};
export const BLOG_TOOLS = {
  get_blog_sources: { command: "getBlogSources", description: "分页读取可选文章属性、正文版本及可明确公开的图片清单；不读取关联记录。" },
  get_blog: { command: "getBlog", description: "读取博客配置、不可变构建清单、真实发布状态和历史。" },
  save_blog: { command: "saveBlog", description: "保存博客模板、显式文章与公开字段映射；不发布。最多20篇，图片须逐项选择。" },
  build_blog: { command: "buildBlog", description: "从获权源生成固定版本静态快照，不发布；源修改后必须重新构建。" },
  publish_blog: { command: "publishBlog", description: "仅在用户明确要求发布并提供本次操作的人类授权token时发布固定buildId；需当前站点版本和线上revision前提。" },
  withdraw_blog_article: { command: "withdrawBlogArticle", description: "撤回单篇及旧版本所有公开路径；需本次操作的人类授权token。其他文章保留当前已发布副本。" },
  unpublish_blog: { command: "unpublishBlog", description: "撤下整个博客及其预览；需本次操作的人类授权token，保留获权内部历史。" },
  restore_blog_revision: { command: "restoreBlogRevision", description: "恢复历史配置为新草稿，不恢复公开状态；重新构建和显式发布。" },
  create_blog_preview: { command: "createBlogPreview", description: "创建10分钟持链接可读的构建预览，noindex；可撤销，发布/撤下使旧预览失效。不可称为登录预览。" },
  revoke_blog_previews: { command: "revokeBlogPreviews", description: "立即撤销本站全部分享预览。" },
} as const satisfies Record<string, { command: BlogCommand; description: string }>;
