import { sql, eq, asc, desc, and, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
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
} from "@table/shared";

const UNGROUPED = "__none__";

function cellTextExpr(columnId: string) {
  // cells ->> 'uuid'
  return sql`(${rows.cells} ->> ${columnId})`;
}

function isEmptySql(columnId: string, type: string): SQL {
  const t = cellTextExpr(columnId);
  if (type === "multi_select") {
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
  return sql`(${t} IS NULL OR ${t} = '')`;
}

function conditionSql(
  f: FilterCondition,
  colMap: Record<string, ColumnDef>
): SQL | null {
  if (!isFilterConditionComplete(f)) return null;
  const col = colMap[f.columnId];
  if (!col) return null;
  const type = col.type;
  const t = cellTextExpr(f.columnId);
  const v = f.value;

  switch (f.op) {
    case "is_empty":
      return isEmptySql(f.columnId, type);
    case "is_not_empty":
      return sql`NOT (${isEmptySql(f.columnId, type)})`;
    case "eq":
      if (type === "checkbox") {
        const bool = Boolean(v);
        return bool
          ? sql`(${t} = 'true' OR ${t} = '1')`
          : sql`(${t} IS NULL OR ${t} = '' OR ${t} = 'false' OR ${t} = '0')`;
      }
      if (type === "number") {
        return sql`(${t})::numeric = ${Number(v)}::numeric`;
      }
      return sql`${t} = ${String(v ?? "")}`;
    case "neq":
      if (type === "number") {
        return sql`(${t})::numeric IS DISTINCT FROM ${Number(v)}::numeric`;
      }
      return sql`${t} IS DISTINCT FROM ${String(v ?? "")}`;
    case "contains":
      if (type === "multi_select") {
        const needle =
          typeof v === "string" ? v : Array.isArray(v) ? v[0] : null;
        if (needle == null) return sql`true`;
        return sql`${rows.cells} -> ${f.columnId} ? ${needle}`;
      }
      return sql`${t} ILIKE ${"%" + String(v ?? "") + "%"}`;
    case "not_contains":
      if (type === "multi_select") {
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
      if (f.op === "gt") return sql`(${t})::numeric > ${n}::numeric`;
      if (f.op === "gte") return sql`(${t})::numeric >= ${n}::numeric`;
      if (f.op === "lt") return sql`(${t})::numeric < ${n}::numeric`;
      return sql`(${t})::numeric <= ${n}::numeric`;
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
  colMap: Record<string, ColumnDef>,
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

function keysetSql(
  cursorRaw: string | null | undefined,
  sort: QueryRowsInput["sort"],
  direction: "asc" | "desc"
): SQL | null {
  const cursor = decodeCursor(cursorRaw);
  if (!cursor) return null;

  if (sort?.columnId) {
    const sv = cursor.sortValue ?? "";
    const t = cellTextExpr(sort.columnId);
    // (sortValue, sortOrder, id) tuple compare
    if (direction === "asc") {
      return sql`(
        COALESCE(${t}, '') > ${sv}
        OR (
          COALESCE(${t}, '') = ${sv}
          AND (
            ${rows.sortOrder} > ${cursor.sortOrder}
            OR (${rows.sortOrder} = ${cursor.sortOrder} AND ${rows.id} > ${cursor.id})
          )
        )
      )`;
    }
    return sql`(
      COALESCE(${t}, '') < ${sv}
      OR (
        COALESCE(${t}, '') = ${sv}
        AND (
          ${rows.sortOrder} < ${cursor.sortOrder}
          OR (${rows.sortOrder} = ${cursor.sortOrder} AND ${rows.id} < ${cursor.id})
        )
      )
    )`;
  }

  // default: (sort_order, id)
  if (direction === "desc") {
    return sql`(
      ${rows.sortOrder} < ${cursor.sortOrder}
      OR (${rows.sortOrder} = ${cursor.sortOrder} AND ${rows.id} < ${cursor.id})
    )`;
  }
  return sql`(
    ${rows.sortOrder} > ${cursor.sortOrder}
    OR (${rows.sortOrder} = ${cursor.sortOrder} AND ${rows.id} > ${cursor.id})
  )`;
}

function orderParts(sort: QueryRowsInput["sort"]) {
  if (sort?.columnId) {
    const t = cellTextExpr(sort.columnId);
    if (sort.direction === "desc") {
      return [sql`${t} DESC NULLS LAST`, desc(rows.sortOrder), desc(rows.id)] as const;
    }
    return [sql`${t} ASC NULLS LAST`, asc(rows.sortOrder), asc(rows.id)] as const;
  }
  return [asc(rows.sortOrder), asc(rows.id)] as const;
}

export async function queryRowsWindowed(
  input: QueryRowsInput,
  opts?: { maxLimit?: number; defaultLimit?: number }
): Promise<QueryRowsResult> {
  const maxLimit = opts?.maxLimit ?? MAX_PAGE_SIZE;
  const defaultLimit = opts?.defaultLimit ?? DEFAULT_PAGE_SIZE;
  const limit = clampLimit(input.limit, defaultLimit, maxLimit);

  const [table] = await db.select().from(tables).where(eq(tables.id, input.tableId));
  if (!table) throw new Error(`表格不存在: ${input.tableId}`);

  const cols = await db
    .select()
    .from(columns)
    .where(eq(columns.tableId, input.tableId))
    .orderBy(asc(columns.sortOrder));
  const colMap = Object.fromEntries(cols.map((c) => [c.id, c as ColumnDef]));

  const direction = input.sort?.direction ?? "asc";
  const baseWhere = buildWhere(input.tableId, colMap, input);
  const cursorPart = keysetSql(input.cursor, input.sort ?? null, direction);
  const whereClause = cursorPart ? and(baseWhere, cursorPart)! : baseWhere;

  const page = await db
    .select()
    .from(rows)
    .where(whereClause)
    
    .orderBy(...orderParts(input.sort ?? null))
    .limit(limit + 1);

  const hasMore = page.length > limit;
  const slice = hasMore ? page.slice(0, limit) : page;

  let nextCursor: string | null = null;
  if (hasMore && slice.length) {
    const last = slice[slice.length - 1];
    const sortValue = input.sort?.columnId
      ? (last.cells?.[input.sort.columnId] != null
          ? String(last.cells[input.sort.columnId] as CellValue)
          : "")
      : undefined;
    nextCursor = encodeCursor({
      sortOrder: last.sortOrder,
      id: last.id,
      sortValue,
    });
  }

  let totalMatched: number | undefined;
  if (input.includeTotal) {
    const [cnt] = await db
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

export async function countTableRows(tableId: string): Promise<number> {
  const [cnt] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(rows)
    .where(eq(rows.tableId, tableId));
  return cnt?.value ?? 0;
}
