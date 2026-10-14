import { and, eq, asc, desc, sql } from "drizzle-orm";
import type { RuntimeDependencies } from "../dependencies.js";
import { ServiceError } from "../errors.js";
import { inTransaction, type Transaction } from "../db/context.js";
import { columns, reports, rows, tables } from "../db/schema.js";
import { reportConfigSchema, reportPageSchema } from "./schema.js";
import type { ReportConfig, ReportData, ReportPageConfig, ReportPageData, ReportMetricQuery, ReportMetricData } from "@tabdo/shared";
import { withReportLayout } from "@tabdo/shared";

const mapReport = (row: typeof reports.$inferSelect) => ({ ...withReportLayout({ ...row.config, name: row.name }), id: row.id, version: row.version, organizationId: row.organizationId, createdAt: row.createdAt, updatedAt: row.updatedAt });
export class ReportError extends ServiceError {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) { super(status, { message }); }
}
export async function getReport(deps: RuntimeDependencies, id: string, organizationId: string, transaction?: Transaction) {
  const [row] = await (transaction ?? deps.database).select().from(reports).where(and(eq(reports.id, id), eq(reports.organizationId, organizationId))).limit(1);
  if (!row) throw new ReportError("报告不存在", 404);
  return mapReport(row);
}
export async function listReports(deps: RuntimeDependencies, organizationId: string, offset = 0, limit = 100, transaction?: Transaction) {
  const found = await (transaction ?? deps.database).select().from(reports).where(eq(reports.organizationId, organizationId)).orderBy(desc(reports.createdAt), desc(reports.id)).limit(limit + 1).offset(offset);
  return { reports: found.slice(0, limit).map(mapReport), hasMore: found.length > limit };
}
export async function validateReport(deps: RuntimeDependencies, config: ReportConfig, organizationId: string, transaction?: Transaction) {
  const [table] = await (transaction ?? deps.database).select().from(tables).where(and(eq(tables.id, config.tableId), eq(tables.organizationId, organizationId))).limit(1);
  if (!table) throw new ReportError("来源表格不存在或已删除", 404);
  const cols = await (transaction ?? deps.database).select().from(columns).where(eq(columns.tableId, table.id)).orderBy(asc(columns.sortOrder));
  const group = cols.find((column) => column.id === config.groupColumnId);
  if (!group || !["text", "select", "date", "checkbox"].includes(group.type)) throw new ReportError("请选择来源表格的文本、单选、日期或复选框分组字段");
  const value = cols.find((column) => column.id === config.valueColumnId);
  if (config.metric !== "count" && (!value || value.type !== "number")) throw new ReportError("求和或平均值需要来源表格中的数字字段");
  return { table, group, value };
}
/** Legacy single-chart inputs become a one-widget page; no report is discarded. */
function normalizePage(deps: RuntimeDependencies, input: ReportPageConfig | ReportConfig): ReportPageConfig {
  if ("widgets" in input) return withReportLayout(reportPageSchema.parse(input));
  const { name, ...query } = reportConfigSchema.parse(input);
  return withReportLayout({ name, description: "", columns: 2, widgets: [{ id: deps.uuid(), type: "chart", title: name, width: "full", query }] });
}
async function validatePage(deps: RuntimeDependencies, input: ReportPageConfig | ReportConfig, organizationId: string, transaction?: Transaction) {
  const page = normalizePage(deps, input);
  for (const widget of page.widgets) {
    if (widget.type === "text") continue;
    const query = widget.query;
    if (!query.tableId) {
      if (query.valueColumnId || (widget.type === "chart" && widget.query.groupColumnId)) throw new ReportError("请先选择组件的来源表格");
      continue;
    }
    const [table] = await (transaction ?? deps.database).select().from(tables).where(and(eq(tables.id, query.tableId), eq(tables.organizationId, organizationId))).limit(1);
    if (!table) throw new ReportError("来源表格不存在或已删除", 404);
    const cols = await (transaction ?? deps.database).select().from(columns).where(eq(columns.tableId, table.id));
    if (query.valueColumnId && !cols.some((c) => c.id === query.valueColumnId && c.type === "number")) throw new ReportError("数字字段必须属于组件的来源表格");
    if (widget.type === "chart" && widget.query.groupColumnId && !cols.some((c) => c.id === widget.query.groupColumnId && ["text", "select", "date", "checkbox"].includes(c.type))) throw new ReportError("请选择组件来源表格的有效分组字段");
  }
  return page;
}
export async function saveReport(deps: RuntimeDependencies, input: ReportPageConfig | ReportConfig, organizationId: string, id?: string, expectedVersion?: number, transaction?: Transaction) {
  const { name, ...config } = await validatePage(deps, input, organizationId, transaction);
  if (id) {
    if (expectedVersion == null) throw new ReportError("更新报告需要版本号，请重新读取报告", 409);
    const [row] = await (transaction ?? deps.database).update(reports).set({ name, config, tableId: null, version: sql`${reports.version} + 1`, updatedAt: deps.now() }).where(and(eq(reports.id, id), eq(reports.organizationId, organizationId), eq(reports.version, expectedVersion))).returning();
    if (!row) { await getReport(deps, id, organizationId, transaction);throw new ReportError("报告已被其他操作更新，请重新加载后再编辑", 409); }
    return mapReport(row);
  }
  const [row] = await (transaction ?? deps.database).insert(reports).values({ name, config, tableId: null, organizationId }).returning();
  return mapReport(row);
}
/** Serialize tool edits so adding/updating one widget cannot overwrite siblings. */
export async function mutateReport(deps: RuntimeDependencies, id: string, organizationId: string, mutate: (page: ReportPageConfig) => ReportPageConfig, transaction?: Transaction) {
  return inTransaction(deps, transaction, async (tx) => {
    const [row] = await tx.select().from(reports).where(and(eq(reports.id, id), eq(reports.organizationId, organizationId))).for("update");
    if (!row) throw new ReportError("报告不存在", 404);
    const { name, ...config } = await validatePage(deps, mutate({ name: row.name, ...row.config }), organizationId, tx);
    const [updated] = await tx.update(reports).set({ name, config, tableId: null, version: row.version + 1, updatedAt: deps.now() }).where(eq(reports.id, id)).returning();
    return mapReport(updated);
  });
}
export async function deleteReport(deps: RuntimeDependencies, id: string, organizationId: string, transaction?: Transaction) {
  const [row] = await (transaction ?? deps.database).delete(reports).where(and(eq(reports.id, id), eq(reports.organizationId, organizationId))).returning({ id: reports.id });
  if (!row) throw new ReportError("报告不存在", 404);
  return { ok: true };
}
/** Aggregate in PostgreSQL; never ship a whole table to the browser. */
export async function queryReport(deps: RuntimeDependencies, config: ReportConfig, organizationId: string, transaction?: Transaction): Promise<ReportData> {
  const { table, group, value } = await validateReport(deps, config, organizationId, transaction);
  const rawGroup = sql<string | null>`${rows.cells}->>${config.groupColumnId}`;
  const groupExpr = group.type === "date" ? sql<string | null>`left(${rawGroup}, ${config.dateBucket === "month" ? 7 : 10})` : rawGroup;
  const numeric = sql`CASE WHEN jsonb_typeof(${rows.cells}->${config.valueColumnId ?? ""}) = 'number' THEN (${rows.cells}->>${config.valueColumnId ?? ""})::numeric END`;
  const metric = config.metric === "count" ? sql<number>`count(*)` : config.metric === "sum" ? sql<number | null>`sum(${numeric})` : sql<number | null>`avg(${numeric})`;
  // Repeating a parameterized expression gives it different PostgreSQL parameter
  // identities ($1 vs $3). Group/order by the first SELECT column instead.
  const grouped = await (transaction ?? deps.database).select({ key: groupExpr, value: metric, records: sql<number>`count(*)`, total: sql<number>`sum(count(*)) over ()` }).from(rows).where(eq(rows.tableId, table.id)).groupBy(sql`1`).orderBy(sql`1 ASC NULLS LAST`).limit(201);
  const labels = new Map(group.config.options?.map((option) => [option.id, option.label]) ?? []);
  const points = grouped.slice(0, 200).map((point) => ({ key: point.key ?? "", label: point.key == null || point.key === "" ? "未填写" : group.type === "select" ? labels.get(point.key) ?? point.key : group.type === "checkbox" ? point.key === "true" ? "已勾选" : "未勾选" : point.key,
    value: point.value == null ? null : Number(point.value), records: Number(point.records) }));
  if (points.some((point) => point.value !== null && !Number.isFinite(point.value))) throw new ReportError("汇总值超出图表支持的数值范围");
  return { points, totalRows: Number(grouped[0]?.total ?? 0), truncated: grouped.length > 200, sourceName: table.name, metricLabel: config.metric === "count" ? "记录数" : `${value!.name} · ${config.metric === "sum" ? "求和" : "平均值"}` };
}

export async function queryMetric(deps: RuntimeDependencies, query: ReportMetricQuery, organizationId: string, transaction?: Transaction): Promise<ReportMetricData> {
  if (!query.tableId) throw new ReportError("请为数字组件选择来源表格");
  const [table] = await (transaction ?? deps.database).select().from(tables).where(and(eq(tables.id, query.tableId), eq(tables.organizationId, organizationId))).limit(1);
  if (!table) throw new ReportError("来源表格不存在或已删除", 404);
  const [column] = query.valueColumnId ? await (transaction ?? deps.database).select().from(columns).where(and(eq(columns.id, query.valueColumnId), eq(columns.tableId, table.id))).limit(1) : [];
  if (query.metric !== "count" && (!column || column.type !== "number")) throw new ReportError("请选择来源表格中的数字字段");
  const numeric = sql`CASE WHEN jsonb_typeof(${rows.cells}->${query.valueColumnId ?? ""}) = 'number' THEN (${rows.cells}->>${query.valueColumnId ?? ""})::numeric END`;
  const metric = query.metric === "count" ? sql`count(*)` : query.metric === "sum" ? sql`sum(${numeric})` : sql`avg(${numeric})`;
  const [result] = await (transaction ?? deps.database).select({ value: metric, totalRows: sql`count(*)` }).from(rows).where(eq(rows.tableId, table.id));
  const value = result.value == null ? null : Number(result.value);
  if (value !== null && !Number.isFinite(value)) throw new ReportError("汇总值超出图表支持的数值范围");
  return { value, totalRows: Number(result.totalRows), sourceName: table.name, metricLabel: query.metric === "count" ? "记录数" : `${column!.name} · ${query.metric === "sum" ? "求和" : "平均值"}` };
}
export async function queryReportPage(deps: RuntimeDependencies, input: ReportPageConfig, organizationId: string, transaction?: Transaction): Promise<ReportPageData> {
  const page = reportPageSchema.parse(input);
  const widgets: ReportPageData["widgets"] = [];
  // At most 40 widgets; serial queries bound database pressure per request.
  for (const widget of page.widgets) {
    if (widget.type === "text") { widgets.push({ id: widget.id, data: null, error: null });continue; }
    if (!widget.query.tableId || (widget.type === "chart" && !widget.query.groupColumnId) || (widget.query.metric !== "count" && !widget.query.valueColumnId)) { widgets.push({ id: widget.id, data: null, error: null });continue; }
    try {
      const data = widget.type === "metric" ? await queryMetric(deps, widget.query, organizationId, transaction) : await queryReport(deps, { ...widget.query, tableId: widget.query.tableId!, groupColumnId: widget.query.groupColumnId!, name: widget.title || "图表" }, organizationId, transaction);
      widgets.push({ id: widget.id, data, error: null });
    } catch (error) {
      if (!(error instanceof ReportError)) throw error;
      widgets.push({ id: widget.id, data: null, error: error.message });
    }
  }
  return { widgets };
}
