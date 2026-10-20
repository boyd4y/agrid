import { z } from "zod";

export const SITE_FILE_SCHEMA = z.strictObject({
  path: z.string().min(1).max(180).regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/)
    .refine(path => !path.split("/").some(part => !part || part === "." || part === "..")),
  content: z.string().max(262144),
});
export const SITE_FILES_SCHEMA = z.array(SITE_FILE_SCHEMA).min(1).max(50).superRefine((files, ctx) => {
  const paths = new Set<string>(); let bytes = 0;
  for (const file of files) {
    if (paths.has(file.path) || [...paths].some(path => path.startsWith(file.path + "/") || file.path.startsWith(path + "/")))
      ctx.addIssue({ code: "custom", message: "File paths must be unique and cannot shadow directories" });
    if (!/\.(html|css|js|mjs|json|svg|txt|md)$/i.test(file.path)) ctx.addIssue({ code: "custom", message: "Unsupported site file type" });
    paths.add(file.path); bytes += new TextEncoder().encode(file.content).byteLength;
  }
  if (!paths.has("index.html")) ctx.addIssue({ code: "custom", message: "index.html is required" });
  if (bytes > 2 * 1024 * 1024) ctx.addIssue({ code: "custom", message: "Site source exceeds 2 MB" });
});
export const SITE_SAVE_SCHEMA = z.strictObject({
  siteId: z.uuid().optional(), name: z.string().trim().min(1).max(100),
  files: SITE_FILES_SCHEMA, expectedVersion: z.number().int().min(1).optional(),
}).refine(input => !input.siteId || input.expectedVersion !== undefined, "An existing site requires expectedVersion");
export type SiteSourceFile = z.infer<typeof SITE_FILE_SCHEMA>;
export type SaveSiteInput = z.infer<typeof SITE_SAVE_SCHEMA>;
/** One fixed browser SDK source per Tabdo deployment, shared by all sites. */
export type SiteConfig = { sdkUrl: string };
export type SiteSummary = { viewId?: string; tableId?: string; kind: "code" | "blog"; workspaceId: string; id: string; name: string; version: number; publishedRevisionId: string | null; publishedVersion: number | null; publicUrl: string; updatedAt: string };
export type SiteRevision = { id: string; version: number; createdAt: string; createdByUserId: string | null };
export type SiteDetail = SiteSummary & { files: SiteSourceFile[]; revisionId: string; revisions: SiteRevision[] };
export type SiteCommands = {
  listSites: Record<string, never>;
  getSite: { siteId: string; revisionId?: string; path?: string };
  saveSite: SaveSiteInput;
  restoreSiteRevision: { siteId: string; revisionId: string; expectedVersion: number };
  publishSite: { siteId: string; revisionId: string };
  unpublishSite: { siteId: string };
  deleteSite: { siteId: string };
};
export type SiteResults = {
  listSites: SiteSummary[]; getSite: SiteDetail; saveSite: SiteDetail;
  restoreSiteRevision: SiteDetail; publishSite: SiteDetail; unpublishSite: SiteDetail; deleteSite: { id: string };
};
