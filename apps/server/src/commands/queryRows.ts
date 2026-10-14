import { cellExpression, rowProjection, relationPredicate, relatedId } from "./relation-reads.js";
import { sql, eq, asc, desc, and, type SQL } from "drizzle-orm";
import { getDatabase } from "@tabdo/backend/resources";
import { type Transaction } from "../db/context.js";
import { columns, rows, tables } from "../db/schema.js";
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type QueryRowsInput,
  type QueryRowsResult,
  type FilterCondition,
  type ColumnDef,
  type CellValue,
  isFilterConditionComplete,
  filterTypeForColumn,
} from "@tabdo/shared";

const UNGROUPED = "__none__";

function cellTextExpr(columnId: string, cols: ColumnDef[] = []) { return cellExpression(columnId,cols); }

function isEmptySql(columnId: string, type: string, cols: ColumnDef[]): SQL {
  const t = cellTextExpr(columnId,cols);
  const col=cols.find(c=>c.id===columnId);
  if(type==="relation"&&col)return sql`NOT EXISTS(SELECT 1 FROM row_relations rr WHERE ${relationPredicate(col)})`;
  if (type === "multi_select" || type === "file") {
    return sql`(
      ${rows.cells} -> ${columnId} IS NULL
      OR jsonb_typeof(${rows.cells} -> ${columnId}) = 'null'
      OR (
        jsonb_typeof(${rows.cells} -> ${columnId}) = 'array'
        AND jsonb_array_length(${rows.cells} -> ${columnId}) = 0
      )
      OR ${t} = ''
    )`;
  }
  if (type === "checkbox") {
    return sql`(${t} IS NULL OR ${t} = '' OR ${t} = 'false')`;
  }
  if (type === "formula") {
    // Auto formula rows may contain booleans or text; only native JSON false is unchecked.
    return sql`(${t} IS NULL OR ${t} = '' OR (jsonb_typeof(${rows.cells} -> ${columnId}) = 'boolean' AND ${t} = 'false'))`;
  }
  return sql`(${t} IS NULL OR ${t} = '')`;
}

function conditionSql(
  f: FilterCondition,
  colMap: Map<string, ColumnDef>
): SQL | null {
  if (!isFilterConditionComplete(f)) return null;
  const col = colMap.get(f.columnId);
  if (!col) return null;
  const cols=[...colMap.values()];
  const type = filterTypeForColumn(col, f.value);
  const raw = cellTextExpr(f.columnId,cols);
  // Computation failures are visible cell values, but cannot be compared as dates/numbers.
  const t = col.type === "formula" && type === "date"
    ? sql`CASE WHEN ${raw} LIKE '#ERR:%' THEN NULL ELSE ${raw} END`
    : raw;
  const numeric = col.type === "formula"
    ? sql`CASE WHEN ${raw} ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' THEN (${raw})::numeric ELSE NULL END`
    : sql`(${t})::numeric`;
  if(type==="relation"&&["eq","neq","contains","not_contains"].includes(f.op)){
    const id=Array.isArray(f.value)?f.value[0]:f.value;
    if(typeof id!=="string"||! /^[0-9a-f-]{36}$/i.test(id))return sql`false`;
    const match=sql`EXISTS(SELECT 1 FROM row_relations rr WHERE ${relationPredicate(col)} AND ${relatedId(col)}=${id}::uuid)`;
    return ["neq","not_contains"].includes(f.op)?sql`NOT (${match})`:match;
  }
  const v = f.value;

  switch (f.op) {
    case "is_empty":
      return isEmptySql(f.columnId, type,cols);
    case "is_not_empty":
      return sql`NOT (${isEmptySql(f.columnId, type,cols)})`;
    case "eq":
      if (type === "checkbox") {
        const bool = Boolean(v);
        return bool
          ? sql`(${t} = 'true' OR ${t} = '1')`
          : sql`(${t} IS NULL OR ${t} = '' OR ${t} = 'false' OR ${t} = '0')`;
      }
      if (type === "number") {
        return sql`${numeric} = ${Number(v)}::numeric`;
      }
      return sql`${t} = ${String(v ?? "")}`;
    case "neq":
      if (type === "number") {
        return sql`${numeric} IS DISTINCT FROM ${Number(v)}::numeric`;
      }
      return sql`${t} IS DISTINCT FROM ${String(v ?? "")}`;
    case "contains":
      if (type === "multi_select" || type === "file") {
        const needle =
          typeof v === "string" ? v : Array.isArray(v) ? v[0] : null;
        if (needle == null) return sql`true`;
        return sql`${rows.cells} -> ${f.columnId} ? ${needle}`;
      }
      return sql`${t} ILIKE ${"%" + String(v ?? "") + "%"}`;
    case "not_contains":
      if (type === "multi_select" || type === "file") {
        const needle =
          typeof v === "string" ? v : Array.isArray(v) ? v[0] : null;
        if (needle == null) return sql`true`;
        return sql`NOT (COALESCE(${rows.cells} -> ${f.columnId}, '[]'::jsonb) ? ${needle})`;
      }
      return sql`COALESCE(${t}, '') NOT ILIKE ${"%" + String(v ?? "") + "%"}`;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (type === "date") {
        const sv = String(v ?? "");
        if (f.op === "gt") return sql`${t} > ${sv}`;
        if (f.op === "gte") return sql`${t} >= ${sv}`;
        if (f.op === "lt") return sql`${t} < ${sv}`;
        return sql`${t} <= ${sv}`;
      }
      const n = Number(v);
      if (f.op === "gt") return sql`${numeric} > ${n}::numeric`;
      if (f.op === "gte") return sql`${numeric} >= ${n}::numeric`;
      if (f.op === "lt") return sql`${numeric} < ${n}::numeric`;
      return sql`${numeric} <= ${n}::numeric`;
    }
    default:
      return null;
  }
}

function statusFilterSql(
  statusColumnId: string,
  statusValue: string | null | undefined
): SQL {
  const t = cellTextExpr(statusColumnId);
  if (statusValue == null || statusValue === UNGROUPED || statusValue === "") {
    return sql`(${t} IS NULL OR ${t} = '')`;
  }
  return sql`${t} = ${statusValue}`;
}

function buildWhere(
  tableId: string,
  colMap: Map<string, ColumnDef>,
  input: QueryRowsInput
): SQL {
  const parts: SQL[] = [eq(rows.tableId, tableId)];

  if (input.statusColumnId) {
    parts.push(statusFilterSql(input.statusColumnId, input.statusValue));
  }

  const filters = input.filters ?? [];
  if (filters.length) {
    const conds = filters
      .map((f) => conditionSql(f, colMap))
      .filter((x): x is SQL => x != null);
    if (conds.length) {
      const logic = input.filterLogic ?? "and";
      parts.push(
        logic === "or"
          ? sql`(${sql.join(conds, sql` OR `)})`
          : sql`(${sql.join(conds, sql` AND `)})`
      );
    }
  }

  return and(...parts)!;
}

function sortExpression(sort:QueryRowsInput["sort"],cols:ColumnDef[]) {
  if(!sort?.columnId)return null;
  const col=cols.find(c=>c.id===sort.columnId);if(!col)throw new Error("排序字段不属于本表");
  if(col.type==="relation")throw new Error("关联字段请通过关联条件筛选，不支持排序");
  const text=cellTextExpr(col.id,cols);
  return col.type==="number"||(col.type==="rollup"&&!["earliest","latest"].includes(col.config.rollup?.operation??"")) ? sql`NULLIF(${text},'')::numeric` : text;
}
function keysetSql(input:QueryRowsInput,cols:ColumnDef[]):SQL|null {
  const cursor=decodeCursor(input.cursor);if(!cursor){if(input.cursor)throw new Error("分页游标无效");return null;}
  const descending=input.sort?.direction==="desc";
  const tuple=descending?sql`(${rows.sortOrder},${rows.id}) < (${cursor.sortOrder},${cursor.id}::uuid)`:sql`(${rows.sortOrder},${rows.id}) > (${cursor.sortOrder},${cursor.id}::uuid)`;
  const expr=sortExpression(input.sort,cols);if(!expr)return tuple;
  if(cursor.sortValue==null||cursor.sortValue==="")return sql`${expr} IS NULL AND ${tuple}`;
  const col=cols.find(c=>c.id===input.sort?.columnId)!;
  const numeric=col.type==="number"||(col.type==="rollup"&&!["earliest","latest"].includes(col.config.rollup?.operation??""));
  const value=numeric?sql`${cursor.sortValue}::numeric`:sql`${cursor.sortValue}::text`;
  const comparison=descending?sql`${expr} < ${value}`:sql`${expr} > ${value}`;
  return sql`(${comparison} OR ${expr} IS NULL OR (${expr}=${value} AND ${tuple}))`;
}
function orderParts(sort:QueryRowsInput["sort"],cols:ColumnDef[]) {
  const expr=sortExpression(sort,cols),descending=sort?.direction==="desc";
  return [...(expr?[descending?sql`${expr} DESC NULLS LAST`:sql`${expr} ASC NULLS LAST`]:[]),descending?desc(rows.sortOrder):asc(rows.sortOrder),descending?desc(rows.id):asc(rows.id)];
}

export async function queryRowsWindowed(
  input: QueryRowsInput,
  opts?: { maxLimit?: number; defaultLimit?: number },
  transaction?: Transaction
): Promise<QueryRowsResult> {
  const maxLimit = opts?.maxLimit ?? MAX_PAGE_SIZE;
  const defaultLimit = opts?.defaultLimit ?? DEFAULT_PAGE_SIZE;
  const limit = clampLimit(input.limit, defaultLimit, maxLimit);

  const [table] = await (transaction ?? getDatabase()).select().from(tables).where(eq(tables.id, input.tableId));
  if (!table) throw new Error(`表格不存在: ${input.tableId}`);

  const cols = await (transaction ?? getDatabase())
    .select()
    .from(columns)
    .where(eq(columns.tableId, input.tableId))
    .orderBy(asc(columns.sortOrder));
  const colMap = new Map(cols.map((c) => [c.id, c as ColumnDef]));

  const baseWhere = buildWhere(input.tableId, colMap, input);
  const cursorPart = keysetSql(input,cols as ColumnDef[]);
  const whereClause = cursorPart ? and(baseWhere, cursorPart)! : baseWhere;

  const page = await (transaction ?? getDatabase())
    .select(rowProjection(cols as ColumnDef[]))
    .from(rows)
    .where(whereClause)
    
    .orderBy(...orderParts(input.sort ?? null,cols as ColumnDef[]))
    .limit(limit + 1);

  const hasMore = page.length > limit;
  const slice = hasMore ? page.slice(0, limit) : page;

  let nextCursor: string | null = null;
  if (hasMore && slice.length) {
    const last = slice[slice.length - 1];
    const sortValue = input.sort?.columnId
      ? (last.cells?.[input.sort.columnId] != null
          ? String(last.cells[input.sort.columnId] as CellValue)
          : null)
      : undefined;
    nextCursor = encodeCursor({
      sortOrder: last.sortOrder,
      id: last.id,
      sortValue,
    });
  }

  let totalMatched: number | undefined;
  if (input.includeTotal) {
    const [cnt] = await (transaction ?? getDatabase())
      .select({ value: sql<number>`count(*)::int` })
      .from(rows)
      .where(baseWhere);
    totalMatched = cnt?.value ?? 0;
  }

  return {
    rows: slice as QueryRowsResult["rows"],
    nextCursor,
    hasMore,
    totalMatched,
    limit,
  };
}

export async function countTableRows(tableId: string, transaction?: Transaction): Promise<number> {
  const [cnt] = await (transaction ?? getDatabase())
    .select({ value: sql<number>`count(*)::int` })
    .from(rows)
    .where(eq(rows.tableId, tableId));
  return cnt?.value ?? 0;
}
