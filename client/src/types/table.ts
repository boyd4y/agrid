import i18n from "@/i18n";
export type ColumnType =
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "date"
  | "checkbox"
  | "person"
  | "formula"
  | "relation"
  | "rollup";

export type SelectOption = { id: string; label: string; color?: string };

export type FormulaResultType =
  | "number"
  | "text"
  | "checkbox"
  | "date"
  | "auto";

export type DateFormat =
  | "YYYY-MM-DD"
  | "YYYY/MM/DD"
  | "MM/DD/YYYY"
  | "DD/MM/YYYY"
  | "MMM D, YYYY";

export const DATE_FORMAT_OPTIONS: { value: DateFormat; label: string }[] = [
  { value: "YYYY-MM-DD", label: "2026-10-11" },
  { value: "YYYY/MM/DD", label: "2026/10/11" },
  { value: "MM/DD/YYYY", label: "10/11/2026" },
  { value: "DD/MM/YYYY", label: "11/10/2026" },
  { value: "MMM D, YYYY", label: "Oct 11, 2026" },
];

export type RelationConfig = {
  relationId?: string;
  direction?: "source" | "target";
  targetTableId: string;
  limit?: "one" | "many";
  inverseName?: string;
  inverseLimit?: "one" | "many";
};
export type RollupConfig = {
  relationColumnId: string;
  targetColumnId?: string;
  operation:
    | "count"
    | "sum"
    | "average"
    | "min"
    | "max"
    | "earliest"
    | "latest";
};
export type RelatedRecord = { id: string; tableId: string; title: string };

export type ColumnConfig = {
  relation?: RelationConfig;
  rollup?: RollupConfig;
  options?: SelectOption[];
  /** view-level hide flag persisted on column */
  hidden?: boolean;
  formula?: string;
  formulaResultType?: FormulaResultType;
  /** display format for date columns; storage stays YYYY-MM-DD */
  dateFormat?: DateFormat;
};

export type CellValue = string | number | boolean | string[] | null;

export type TableMeta = {
  id: string;
  name: string;
  description: string | null;
  icon?: string | null;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ColumnDef = {
  id: string;
  tableId: string;
  name: string;
  type: ColumnType;
  config: ColumnConfig;
  width: number;
  sortOrder: number;
  createdAt: string;
};

export type RowData = {
  id: string;
  tableId: string;
  cells: Record<string, CellValue>;
  sortOrder: number;
  version?: number;
  relations?: Record<string, { records: RelatedRecord[]; total: number }>;
  affectedTableIds?: string[];
  createdAt: string;
  updatedAt: string;
};

export type FullTable = TableMeta & {
  columns: ColumnDef[];
  /** local cache / empty — server no longer dumps all rows */
  rows: RowData[];
  rowCount: number;
};

export type QueryRowsPage = {
  rows: RowData[];
  nextCursor: string | null;
  hasMore: boolean;
  totalMatched?: number;
  limit: number;
};

const COLUMN_TYPE_KEYS: ColumnType[] = [
  "text", "number", "select", "multi_select", "date", "checkbox", "person", "formula", "relation", "rollup",
];

/** Live labels — reads current i18n language. Prefer iterating COLUMN_TYPE_KEYS for menus. */
export const COLUMN_TYPE_LABELS = Object.defineProperties({} as Record<ColumnType, string>,
  Object.fromEntries(COLUMN_TYPE_KEYS.map((type) => [type, { enumerable: true, get: () => i18n.t(`table:columnTypes.${type}`) }])));

const FORMULA_RESULT_KEYS: FormulaResultType[] = ["auto", "number", "text", "checkbox", "date"];

export const FORMULA_RESULT_TYPE_LABELS = Object.defineProperties({} as Record<FormulaResultType, string>,
  Object.fromEntries(FORMULA_RESULT_KEYS.map((type) => [type, { enumerable: true, get: () => i18n.t(`table:formulaResult.${type}`) }])));
