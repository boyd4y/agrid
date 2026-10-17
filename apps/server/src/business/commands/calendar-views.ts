import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  CALENDAR_VIEW_CONFIG_SCHEMA, CREATE_CALENDAR_VIEW_SCHEMA, UPDATE_CALENDAR_VIEW_SCHEMA, QUERY_CALENDAR_VIEW_SCHEMA,
  type CalendarViewConfig, type CalendarMappingIssue, type CalendarViewResult,
  type CreateCalendarViewInput, type UpdateCalendarViewInput, type QueryCalendarViewInput,
} from "@tabdo/shared";
import { ServiceError } from "../errors.js";
import type { CommandDependencies } from "../dependencies.js";
import { inTransaction, type Transaction } from "../db/context.js";
import { rows, tableViews } from "../db/schema.js";
import { requireTableInOrg } from "../tenant/scope.js";
import { insertView, loadColumns, lockTable, requireViewInOrg, toTableView, type OrgScoped } from "./views.js";

export function calendarMappingIssues(config: CalendarViewConfig, cols: { id: string; type: string; config: { hidden?: boolean } }[]): CalendarMappingIssue[] {
  const issues: CalendarMappingIssue[] = [];
  for (const field of ["startColumnId", "endColumnId", "titleColumnId", "personColumnId"] as const) {
    const id = config[field]; if (!id) continue;
    const col = cols.find(column => column.id === id);
    const type = field === "titleColumnId" ? "text" : field === "personColumnId" ? "person" : "date";
    if (!col) issues.push({ field, code: "missing" });
    else if (col.config.hidden) issues.push({ field, code: "hidden" });
    else if (col.type !== type) issues.push({ field, code: "type" });
  }
  return issues;
}
async function validateConfig(deps: CommandDependencies, tableId: string, config: CalendarViewConfig, tx: Transaction) {
  if (calendarMappingIssues(config, await loadColumns(deps, tableId, tx)).length) throw new Error("日历映射需要本表未隐藏的日期、文本标题和人员字段");
}
export async function createCalendarView(deps: CommandDependencies, input: CreateCalendarViewInput & OrgScoped, transaction?: Transaction) {
  const parsed = CREATE_CALENDAR_VIEW_SCHEMA.parse({ tableId: input.tableId, name: input.name, config: input.config });
  await requireTableInOrg(deps, parsed.tableId, input.organizationId, transaction);
  return inTransaction(deps, transaction, async tx => {
    await lockTable(deps, tx, parsed.tableId);
    await validateConfig(deps, parsed.tableId, parsed.config, tx);
    return toTableView(await insertView(deps, parsed.tableId, { type: "calendar", name: parsed.name ?? "日历", config: parsed.config }, tx));
  });
}
export async function updateCalendarView(deps: CommandDependencies, input: UpdateCalendarViewInput & OrgScoped, transaction?: Transaction) {
  const parsed = UPDATE_CALENDAR_VIEW_SCHEMA.parse({ viewId: input.viewId, config: input.config });
  const view = await requireViewInOrg(deps, parsed.viewId, input.organizationId, transaction);
  if (view.type !== "calendar") throw new ServiceError(400, { message: "需要日历视图" });
  return inTransaction(deps, transaction, async tx => {
    await lockTable(deps, tx, view.tableId);
    await validateConfig(deps, view.tableId, parsed.config, tx);
    const [saved] = await tx.update(tableViews).set({ config: parsed.config, updatedAt: deps.now() }).where(eq(tableViews.id, view.id)).returning();
    if (!saved) throw new Error("视图已被删除");
    return toTableView(saved);
  });
}

/** No cast is evaluated until the shape is known. Impossible dates never reach a PG date cast. */
function validDate(raw: SQL): SQL<string | null> {
  const year = sql`substring(${raw}, 1, 4)::int`, month = sql`substring(${raw}, 6, 2)::int`, day = sql`substring(${raw}, 9, 2)::int`;
  return sql`CASE WHEN ${raw} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN CASE WHEN
    ${year} BETWEEN 1 AND 9998 AND ${month} BETWEEN 1 AND 12 AND ${day} BETWEEN 1 AND
    CASE WHEN ${month} = 2 THEN CASE WHEN ${year} % 400 = 0 OR (${year} % 4 = 0 AND ${year} % 100 <> 0) THEN 29 ELSE 28 END
    WHEN ${month} IN (4,6,9,11) THEN 30 ELSE 31 END THEN ${raw} ELSE NULL END ELSE NULL END`;
}
const cursorSchema = z.object({ scope: z.string(), start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), id: z.uuid() });

export async function queryCalendarView(deps: CommandDependencies, input: QueryCalendarViewInput & OrgScoped, transaction?: Transaction): Promise<CalendarViewResult> {
  const parsed = QUERY_CALENDAR_VIEW_SCHEMA.parse({ viewId: input.viewId, rangeStart: input.rangeStart, rangeEnd: input.rangeEnd, cursor: input.cursor, limit: input.limit });
  const view = await requireViewInOrg(deps, parsed.viewId, input.organizationId, transaction);
  if (view.type !== "calendar") throw new ServiceError(400, { message: "需要日历视图" });
  const result: CalendarViewResult = { items: [], nextCursor: null, hasMore: false, limit: parsed.limit, diagnostics: { mapping: [], emptyStart: 0, invalidStart: 0, invalidEnd: 0, reversed: 0 } };
  const config = CALENDAR_VIEW_CONFIG_SCHEMA.safeParse(view.config);
  if (!config.success) { result.diagnostics.mapping = [{ field: "startColumnId", code: "invalid_config" }]; return result; }
  const settings = config.data;
  result.diagnostics.mapping = calendarMappingIssues(settings, await loadColumns(deps, view.tableId, transaction));
  // Fail closed: hidden/deleted/retyped mappings cannot disclose values or drive predicates.
  if (result.diagnostics.mapping.length) return result;
  const scope = JSON.stringify([view.id, settings, parsed.rangeStart, parsed.rangeEnd]);
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (parsed.cursor) {
    try { cursor = cursorSchema.parse(JSON.parse(atob(parsed.cursor))); } catch { throw new ServiceError(400, { message: "日历分页游标无效" }); }
    if (cursor.scope !== scope) throw new ServiceError(400, { message: "日历分页游标与当前范围或映射不匹配" });
  }
  const query = transaction ?? deps.database;
  const rawStart = sql`${rows.cells}->>${settings.startColumnId}`;
  const rawEnd = settings.endColumnId ? sql`${rows.cells}->>${settings.endColumnId}` : sql`NULL::text`;
  const start = validDate(rawStart), end = validDate(rawEnd);
  const missingEnd = sql`(${rawEnd} IS NULL OR ${rawEnd} = '')`;
  const effectiveEnd = sql<string>`CASE WHEN ${missingEnd} THEN ((${start})::date + 1)::text
    WHEN ${end} IS NOT NULL THEN ${settings.endMode === "inclusive" ? sql`((${end})::date + 1)::text` : end} ELSE NULL END`;
  const valid = sql`(${start} IS NOT NULL AND ${effectiveEnd} > ${start})`;
  const [counts] = await query.select({
    emptyStart: sql<number>`count(*) FILTER (WHERE ${rawStart} IS NULL OR ${rawStart} = '')::int`,
    invalidStart: sql<number>`count(*) FILTER (WHERE ${rawStart} IS NOT NULL AND ${rawStart} <> '' AND ${start} IS NULL)::int`,
    invalidEnd: sql<number>`count(*) FILTER (WHERE ${start} IS NOT NULL AND NOT ${missingEnd} AND ${end} IS NULL)::int`,
    reversed: sql<number>`count(*) FILTER (WHERE ${start} IS NOT NULL AND ${effectiveEnd} <= ${start})::int`,
  }).from(rows).where(eq(rows.tableId, view.tableId));
  Object.assign(result.diagnostics, counts);
  const page = await query.select({ rowId: rows.id, version: rows.version, start, end: effectiveEnd,
    title: settings.titleColumnId ? sql<string | null>`${rows.cells}->>${settings.titleColumnId}` : sql<null>`NULL`,
    person: settings.personColumnId ? sql<string | string[] | null>`${rows.cells}->${settings.personColumnId}` : sql<null>`NULL`,
  }).from(rows).where(and(eq(rows.tableId, view.tableId), valid,
    sql`${start} < ${parsed.rangeEnd} AND ${effectiveEnd} > ${parsed.rangeStart}`,
    cursor ? sql`(${start}, ${rows.id}) > (${cursor.start}, ${cursor.id}::uuid)` : undefined,
  )).orderBy(asc(start), asc(rows.id)).limit(parsed.limit + 1);
  result.hasMore = page.length > parsed.limit;
  result.items = page.slice(0, parsed.limit).map(item => ({ ...item, start: item.start! }));
  const last = result.items.at(-1);
  if (last && result.hasMore) result.nextCursor = btoa(JSON.stringify({ scope, start: last.start, id: last.rowId }));
  return result;
}
