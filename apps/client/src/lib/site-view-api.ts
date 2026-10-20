import type { BlogConfig, BlogSource, ColumnDef, SiteViewConfig, SiteViewState, TableView, UpdateViewInput } from "@tabdo/shared";
import { api } from "@/lib/api";
import { rowCommand } from "./row-body-api";
export type SiteEditorDetail = SiteViewState & { viewId: string; name: string; config: BlogConfig; publishedArticles: SiteViewState["publishedRows"] };
export function editorDetail(view: TableView): SiteEditorDetail {
  if (!view.site) throw new Error("Site view not found");
  const { template, ...config } = view.config as SiteViewConfig;
  return { ...view.site, viewId: view.id, name: view.name, config: { ...config, tableId: view.tableId }, publishedArticles: view.site.publishedRows };
}
export const getSiteView = async (viewId: string) => editorDetail(await rowCommand("getView", { viewId }));
export const patchSiteView = async (input: UpdateViewInput) => editorDetail(await rowCommand("updateView", input));
export const siteConfig = (config: BlogConfig): SiteViewConfig => { const { tableId, ...rest } = config; return { ...rest, template: "blog" }; };
export async function loadViewRows(tableId: string, cursor?: string | null) {
  const [table, page] = await Promise.all([api.getTable(tableId), api.queryRows({ tableId, limit: 20, cursor: cursor ?? null })]);
  const fileIds = page.rows.flatMap(row => table.columns.filter(column => column.type === "file").flatMap(column => Array.isArray(row.cells[column.id]) ? row.cells[column.id] as string[] : []));
  const files = fileIds.length ? (await api.getFiles([...new Set(fileIds)])).files : [];
  const items: BlogSource[] = await Promise.all(page.rows.map(async row => {
    const { body } = await rowCommand("getRow", { rowId: row.id, includeBody: true });
    return { rowId: row.id, rowVersion: row.version ?? 1, documentVersion: body?.version ?? 0, cells: row.cells, images: body?.attachments.map(image => ({ id: image.fileId, ...image })) ?? [], covers: files.filter(file => fileIds.includes(file.id) && /^image\/(png|jpeg|webp|gif)$/.test(file.mimeType) && table.columns.some(column => column.type === "file" && Array.isArray(row.cells[column.id]) && (row.cells[column.id] as string[]).includes(file.id))).map(file => ({ id: file.id, columnId: table.columns.find(column => column.type === "file" && Array.isArray(row.cells[column.id]) && (row.cells[column.id] as string[]).includes(file.id))!.id, name: file.name, size: file.size })) };
  }));
  return { columns: table.columns as ColumnDef[], items, nextAfterId: page.nextCursor };
}
