import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { FILTER_OPS, decodeCursor, opsForType, isFilterConditionComplete, validateCell, type CellValue, type ColumnDef, type SiteTable, type SiteRow, type SiteFile, type ColumnType } from "@tabdo/shared";
import { columns, fileObjects, rows, tables } from "../db/schema.js";
import type { CommandDependencies } from "../dependencies.js";
import type { Database } from "../db/types.js";
import { addRow, queryRows } from "../commands/rows.js";
import { readRow } from "../commands/relation-reads.js";
import { ServiceError } from "../errors.js";
import { requireSiteTable, resolveSiteKey, type SitePrincipal } from "./keys.js";

export type SiteContext = { principal: SitePrincipal; secret: string; baseUrl: string };
export const cellSchema = z.union([z.string().max(64000), z.number().finite(), z.boolean(), z.array(z.string().max(64000)).max(100), z.null()]);
export const rowsOptions = z.object({ cursor: z.string().max(4000).nullable().optional(), limit: z.number().int().min(1).max(100).default(50),
  filters: z.array(z.object({ id: z.string().optional(), columnId: z.uuid(), op: z.enum(FILTER_OPS), value: cellSchema.optional() })).max(30).optional(),
  filterLogic: z.enum(["and", "or"]).optional(), sort: z.object({ columnId: z.uuid(), direction: z.enum(["asc", "desc"]) }).nullable().optional(), includeTotal: z.boolean().optional(),
});
const writable = new Set(["text", "number", "date", "checkbox", "select", "multi_select"]);
export function readableColumn(col: ColumnDef, cols: ColumnDef[], principal: SitePrincipal): boolean {
  if (col.type === "relation") return !!col.config.relation && principal.tableIds.has(col.config.relation.targetTableId);
  if (col.type === "rollup") {
    const relation = cols.find(candidate => candidate.id === col.config.rollup?.relationColumnId);
    return !!relation && relation.type === "relation" && readableColumn(relation, cols, principal);
  }
  // A formula can incorporate another field. Conservatively redact formulas
  // when any linked source is private; do not expose a derived side channel.
  if (col.type === "formula") return !cols.some(candidate => ["relation", "rollup"].includes(candidate.type) && !readableColumn(candidate, cols, principal));
  return true;
}
export async function tableColumns(database: Database, principal: SitePrincipal, tableId: string, operation?: "read" | "create") {
  requireSiteTable(principal, tableId, operation);
  const [table] = await database.select().from(tables).where(and(eq(tables.id, tableId), eq(tables.organizationId, principal.organizationId)));
  if (!table) throw new ServiceError(404, { message: "Table not found" });
  const cols = await database.select().from(columns).where(eq(columns.tableId, tableId)).orderBy(asc(columns.sortOrder));
  return { table, cols: cols as ColumnDef[] };
}
export async function siteTable(deps: CommandDependencies, context: SiteContext, tableId: string): Promise<SiteTable> {
  const { table, cols } = await tableColumns(deps.database, context.principal, tableId);
  return { id: table.id, name: table.name, description: table.description,
    columns: cols.map(col => ({ id: col.id, name: col.name, type: col.type as ColumnType, options: col.config.options ?? [],
      readable: context.principal.canRead && readableColumn(col, cols, context.principal), writable: context.principal.canCreate && writable.has(col.type) })) };
}
export async function siteTables(deps: CommandDependencies, context: SiteContext) {
  const ids = [...context.principal.tableIds]; if (!ids.length) return [];
  // Batch metadata across the allowed tables; GraphQL must not do N+1 schema reads.
  const [found, allCols] = await Promise.all([
    deps.database.select({ id: tables.id, name: tables.name, description: tables.description }).from(tables)
      .where(and(eq(tables.organizationId, context.principal.organizationId), inArray(tables.id, ids))).orderBy(asc(tables.name), asc(tables.id)),
    deps.database.select().from(columns).where(inArray(columns.tableId, ids)).orderBy(asc(columns.sortOrder)),
  ]);
  return found.map(table => {
    const cols = allCols.filter(col => col.tableId === table.id) as ColumnDef[];
    return { ...table, columns: cols.map(col => ({ id: col.id, name: col.name, type: col.type, options: col.config.options ?? [],
      readable: context.principal.canRead && readableColumn(col, cols, context.principal), writable: context.principal.canCreate && writable.has(col.type) })) };
  });
}
async function serializeRows(deps: CommandDependencies, context: SiteContext, tableId: string, cols: ColumnDef[], records: { id: string; cells: Record<string, CellValue>; createdAt: string | Date; updatedAt: string | Date }[]): Promise<SiteRow[]> {
  const visible = cols.filter(col => readableColumn(col, cols, context.principal));
  const fileCols = visible.filter(col => col.type === "file");
  const ids = [...new Set(records.flatMap(row => fileCols.flatMap(col => Array.isArray(row.cells[col.id]) ? row.cells[col.id] as string[] : [])))].filter(value => z.uuid().safeParse(value).success);
  const files = ids.length ? await deps.database.select().from(fileObjects).where(and(eq(fileObjects.organizationId, context.principal.organizationId), eq(fileObjects.tableId, tableId), inArray(fileObjects.id, ids))) : [];
  const byId = new Map(files.map(file => [file.id, file]));
  return records.map(row => ({ id: row.id, tableId,
    cells: Object.fromEntries(cols.map(col => [col.id, visible.includes(col) ? row.cells[col.id] ?? null : null])),
    files: fileCols.flatMap(col => (Array.isArray(row.cells[col.id]) ? row.cells[col.id] as string[] : []).flatMap(id => {
      const file = byId.get(id); if (!file || file.columnId !== col.id) return [];
      const url = new URL(`/api/site-files/${tableId}/${row.id}/${col.id}/${id}`, context.baseUrl); url.searchParams.set("key", context.secret);
      return [{ id, columnId: col.id, name: file.name, size: file.size, mimeType: file.mimeType, url: url.href } satisfies SiteFile];
    })), createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
  }));
}
export async function siteRows(deps: CommandDependencies, context: SiteContext, tableId: string, input: unknown) {
  const { cols } = await tableColumns(deps.database, context.principal, tableId, "read");
  const parsed = rowsOptions.parse(input ?? {});
  if (parsed.cursor && !z.object({ id: z.uuid(), sortOrder: z.number().int().finite(), sortValue: z.string().nullable().optional() }).safeParse(decodeCursor(parsed.cursor)).success)
    throw new ServiceError(400, { message: "Invalid row cursor" });
  for (const filter of parsed.filters ?? []) {
    const col = cols.find(candidate => candidate.id === filter.columnId);
    const condition = { ...filter, id: filter.id ?? filter.columnId };
    if (!col || !readableColumn(col, cols, context.principal) || !opsForType(col.type).includes(filter.op) || !isFilterConditionComplete(condition))
      throw new ServiceError(400, { message: "Invalid or inaccessible filter column" });
    if (filter.value !== undefined && !["is_empty", "is_not_empty"].includes(filter.op)) {
      const filterValue = ["multi_select", "relation"].includes(col.type) && typeof filter.value === "string" ? [filter.value] : filter.value;
      const error = validateCell(col.type, filterValue, col.config.options);
      if (error && !["formula", "rollup"].includes(col.type)) throw new ServiceError(400, { message: "Invalid filter value" });
    }
  }
  if (parsed.sort && !cols.some(col => col.id === parsed.sort!.columnId && readableColumn(col, cols, context.principal)))
    throw new ServiceError(400, { message: "Invalid or inaccessible sort column" });
  const page = await queryRows(deps, { ...parsed, filters: parsed.filters?.map(filter => ({ ...filter, id: filter.id ?? filter.columnId })), tableId, organizationId: context.principal.organizationId });
  return { ...page, totalMatched: page.totalMatched ?? null, rows: await serializeRows(deps, context, tableId, cols, page.rows) };
}
export async function siteRow(deps: CommandDependencies, context: SiteContext, tableId: string, rowId: string) {
  const { cols } = await tableColumns(deps.database, context.principal, tableId, "read");
  if (!z.uuid().safeParse(rowId).success) return null;
  const [hit] = await deps.database.select({ id: rows.id }).from(rows).where(and(eq(rows.id, rowId), eq(rows.tableId, tableId)));
  if (!hit) return null;
  const row = await readRow(deps, rowId, cols);
  return (await serializeRows(deps, context, tableId, cols, [row]))[0];
}
export async function siteCreateRow(deps: CommandDependencies, context: SiteContext, tableId: string, rawCells: unknown) {
  const cells = z.record(z.uuid(), cellSchema).parse(rawCells);
  return deps.database.transaction(async tx => {
    const principal = await resolveSiteKey(tx, context.secret, true);
    requireSiteTable(principal, tableId, "create");
    // Schema writers lock the table first; hold it before validating columns.
    await tx.select({ id: tables.id }).from(tables).where(and(eq(tables.id, tableId), eq(tables.organizationId, principal.organizationId))).for("update");
    const { cols } = await tableColumns(tx, principal, tableId, "create");
    for (const [columnId, value] of Object.entries(cells)) {
      const col = cols.find(candidate => candidate.id === columnId);
      if (!col || !writable.has(col.type)) throw new ServiceError(400, { message: "This column cannot be created through the site API" });
      const error = validateCell(col.type, value, col.config.options);
      if (error) throw new ServiceError(400, { message: `Invalid value for ${col.name}` });
    }
    // Public visitors are not the key creator. No forged human actor is used.
    const row = await addRow(deps, { tableId, cells, organizationId: principal.organizationId }, tx);
    return { id: row.id, createdAt: new Date(row.createdAt).toISOString() };
  });
}
export async function siteFileReference(deps: CommandDependencies, context: SiteContext, tableId: string, rowId: string, columnId: string, fileId: string) {
  if ([tableId, rowId, columnId, fileId].some(value => !z.uuid().safeParse(value).success)) throw new ServiceError(404, { message: "File not found" });
  const { cols } = await tableColumns(deps.database, context.principal, tableId, "read");
  const col = cols.find(candidate => candidate.id === columnId && candidate.type === "file");
  const [row] = await deps.database.select({ cells: rows.cells }).from(rows).where(and(eq(rows.id, rowId), eq(rows.tableId, tableId)));
  if (!col || !row || !Array.isArray(row.cells[columnId]) || !(row.cells[columnId] as string[]).includes(fileId)) throw new ServiceError(404, { message: "File not found" });
  const [file] = await deps.database.select().from(fileObjects).where(and(eq(fileObjects.id, fileId), eq(fileObjects.organizationId, context.principal.organizationId), eq(fileObjects.tableId, tableId), eq(fileObjects.columnId, columnId)));
  if (!file) throw new ServiceError(404, { message: "File not found" });
  return file;
}
