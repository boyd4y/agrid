import type { CellValue, ColumnDef, ColumnType, RowData } from "./types.js";

export const FILTER_OPS = [
  "eq",
  "neq",
  "contains",
  "not_contains",
  "is_empty",
  "is_not_empty",
  "gt",
  "gte",
  "lt",
  "lte",
] as const;

export type FilterOp = (typeof FILTER_OPS)[number];

export type FilterCondition = {
  id: string;
  columnId: string;
  op: FilterOp;
  value?: CellValue;
};

export type FilterLogic = "and" | "or";

export type TableQuery = {
  filters?: FilterCondition[];
  filterLogic?: FilterLogic;
  sort?: { columnId: string; direction: "asc" | "desc" } | null;
  /** hidden column ids (view-local; agents may ignore) */
  hiddenColumnIds?: string[];
};

/** Resolve computed filter comparisons without treating dates/booleans as numbers. */
export function filterTypeForColumn(column: ColumnDef, comparisonValue?: CellValue): ColumnType | string {
  if (column.type === "rollup") return ["earliest", "latest"].includes(column.config.rollup?.operation ?? "") ? "date" : "number";
  if (column.type !== "formula") return column.type;
  const declared = column.config.formulaResultType;
  if (declared && declared !== "auto") return declared;
  // Auto formulas preserve their native value; typed comparisons identify the scalar kind.
  if (typeof comparisonValue === "boolean") return "checkbox";
  if (typeof comparisonValue === "number") return "number";
  if (typeof comparisonValue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(comparisonValue)) return "date";
  return "formula";
}

export function opsForType(type: ColumnType | string): FilterOp[] {
  switch (type) {
    case "number":
      return [
        "eq",
        "neq",
        "gt",
        "gte",
        "lt",
        "lte",
        "is_empty",
        "is_not_empty",
      ];
    case "checkbox":
      return ["eq", "is_empty", "is_not_empty"];
    case "select":
    case "person":
      return ["eq", "neq", "is_empty", "is_not_empty"];
    case "relation":
    case "multi_select":
      return ["contains", "not_contains", "is_empty", "is_not_empty"];
    case "date":
      return [
        "eq",
        "neq",
        "gt",
        "gte",
        "lt",
        "lte",
        "is_empty",
        "is_not_empty",
      ];
    case "rollup":
    case "formula":
      return [
        "eq",
        "neq",
        "contains",
        "not_contains",
        "gt",
        "gte",
        "lt",
        "lte",
        "is_empty",
        "is_not_empty",
      ];
    case "text":
    default:
      return [
        "eq",
        "neq",
        "contains",
        "not_contains",
        "is_empty",
        "is_not_empty",
      ];
  }
}

export const FILTER_OP_LABELS: Record<FilterOp, string> = {
  eq: "等于",
  neq: "不等于",
  contains: "包含",
  not_contains: "不包含",
  is_empty: "为空",
  is_not_empty: "不为空",
  gt: "大于",
  gte: "大于等于",
  lt: "小于",
  lte: "小于等于",
};

function isEmpty(v: CellValue): boolean {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

function matchCondition(
  cell: CellValue,
  op: FilterOp,
  value: CellValue | undefined,
  type: string,
): boolean {
  switch (op) {
    case "is_empty":
      return isEmpty(cell) || (type === "checkbox" && cell === false);
    case "is_not_empty":
      return !(isEmpty(cell) || (type === "checkbox" && cell === false));
    case "eq":
      if (type === "checkbox") return Boolean(cell) === Boolean(value);
      if (Array.isArray(cell)) return false;
      return cell === value;
    case "neq":
      if (type === "checkbox") return Boolean(cell) !== Boolean(value);
      return cell !== value;
    case "contains":
      if (
        (type === "multi_select" || type === "relation") &&
        Array.isArray(cell)
      ) {
        const needle =
          typeof value === "string"
            ? value
            : Array.isArray(value)
              ? value[0]
              : null;
        return needle != null && cell.includes(needle);
      }
      return String(cell ?? "").includes(String(value ?? ""));
    case "not_contains":
      if (
        (type === "multi_select" || type === "relation") &&
        Array.isArray(cell)
      ) {
        const needle =
          typeof value === "string"
            ? value
            : Array.isArray(value)
              ? value[0]
              : null;
        return needle == null || !cell.includes(needle);
      }
      return !String(cell ?? "").includes(String(value ?? ""));
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (typeof cell === "string" && cell.startsWith("#ERR:")) return false;
      const a = type === "date" ? String(cell ?? "") : Number(cell);
      const b = type === "date" ? String(value ?? "") : Number(value);
      if (
        type !== "date" &&
        (Number.isNaN(a as number) || Number.isNaN(b as number))
      )
        return false;
      if (op === "gt") return a > b;
      if (op === "gte") return a >= b;
      if (op === "lt") return a < b;
      return a <= b;
    }
    default:
      return true;
  }
}

/** Ops that need a comparison value. Incomplete (empty) rules are skipped. */
export function filterNeedsValue(op: FilterOp): boolean {
  return op !== "is_empty" && op !== "is_not_empty";
}

/** True when a condition is ready to apply (is_empty/is_not_empty always; others need a non-empty value). */
export function isFilterConditionComplete(f: FilterCondition): boolean {
  if (!f.columnId) return false;
  if (!filterNeedsValue(f.op)) return true;
  const v = f.value;
  if (v === null || v === undefined || v === "") return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

export function applyFilters(
  rows: RowData[],
  columns: ColumnDef[],
  query: TableQuery,
): RowData[] {
  const filters = (query.filters ?? []).filter(isFilterConditionComplete);
  const logic = query.filterLogic ?? "and";
  const colMap = Object.fromEntries(columns.map((c) => [c.id, c]));

  let result = rows;
  if (filters.length) {
    result = rows.filter((row) => {
      const checks = filters.map((f) => {
        const col = colMap[f.columnId];
        if (!col) return true;
        const type = filterTypeForColumn(col, filterNeedsValue(f.op) ? f.value : row.cells[f.columnId]);
        return matchCondition(
          row.cells[f.columnId] ?? null,
          f.op,
          f.value,
          type,
        );
      });
      return logic === "and" ? checks.every(Boolean) : checks.some(Boolean);
    });
  }

  if (query.sort?.columnId) {
    const { columnId, direction } = query.sort;
    const col = colMap[columnId];
    const dir = direction === "desc" ? -1 : 1;
    result = [...result].sort((ra, rb) => {
      const a = ra.cells[columnId] ?? null;
      const b = rb.cells[columnId] ?? null;
      if (isEmpty(a) && isEmpty(b)) return 0;
      if (isEmpty(a)) return 1;
      if (isEmpty(b)) return -1;
      if (
        col?.type === "number" ||
        (col?.type === "rollup" &&
          !["earliest", "latest"].includes(
            col.config.rollup?.operation ?? "",
          )) ||
        (col?.type === "formula" &&
          typeof a === "number" &&
          typeof b === "number")
      )
        return (Number(a) - Number(b)) * dir;
      if (col?.type === "checkbox")
        return (Number(Boolean(a)) - Number(Boolean(b))) * dir;
      return String(a).localeCompare(String(b), "zh") * dir;
    });
  }

  return result;
}

/** Validate cell value against column type; returns error message or null */
export function validateCell(
  type: ColumnType | string,
  value: CellValue,
  options?: { id: string }[],
): string | null {
  if (value === null || value === undefined || value === "") return null;
  switch (type) {
    case "rollup":
    case "formula":
      return "公式列只读，由表达式自动计算";
    case "number":
      if (typeof value !== "number" || Number.isNaN(value))
        return "必须是有效数字";
      return null;
    case "checkbox":
      if (typeof value !== "boolean") return "必须是布尔值";
      return null;
    case "select":
    case "person":
      if (typeof value !== "string") return "必须是字符串选项 id";
      if (options?.length && !options.some((o) => o.id === value))
        return "选项不存在";
      return null;
    case "relation":
    case "multi_select":
      if (!Array.isArray(value)) return "必须是字符串数组";
      if (
        options?.length &&
        value.some((id) => !options.some((o) => o.id === id))
      ) {
        return "包含无效选项";
      }
      return null;
    case "date":
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return "日期格式应为 YYYY-MM-DD";
      }
      return null;
    case "text":
      if (typeof value !== "string" && typeof value !== "number")
        return "类型不匹配";
      return null;
    default:
      return `未知列类型: ${type}`;
  }
}
