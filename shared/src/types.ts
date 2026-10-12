export const COLUMN_TYPES = [
  "text",
  "number",
  "select",
  "multi_select",
  "date",
  "checkbox",
  "person",
  "formula",
] as const;

export type ColumnType = (typeof COLUMN_TYPES)[number];

export type SelectOption = { id: string; label: string; color?: string };

export type FormulaResultType = "number" | "text" | "checkbox" | "date" | "auto";

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

export type ColumnConfig = {
  options?: SelectOption[];
  /** view-level hide flag persisted on column */
  hidden?: boolean;
  /** formula expression, e.g. `{预估工时} * 8` or `IF({已完成}, "✓", "")` */
  formula?: string;
  /** coerce formula result; default auto */
  formulaResultType?: FormulaResultType;
  /** display format for date columns; storage stays YYYY-MM-DD */
  dateFormat?: DateFormat;
};

export type CellValue = string | number | boolean | string[] | null;

export type TableMeta = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type ColumnDef = {
  id: string;
  tableId: string;
  name: string;
  type: ColumnType | string;
  config: ColumnConfig;
  width: number;
  sortOrder: number;
  createdAt: string | Date;
};

export type RowData = {
  id: string;
  tableId: string;
  cells: Record<string, CellValue>;
  sortOrder: number;
  version?: number;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type FullTable = TableMeta & {
  columns: ColumnDef[];
  /** windowed / empty by default — never dump 100k rows here */
  rows: RowData[];
  /** total row count for the table (unfiltered) */
  rowCount: number;
};

export const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  text: "文本",
  number: "数字",
  select: "单选",
  multi_select: "多选",
  date: "日期",
  checkbox: "勾选",
  person: "人员",
  formula: "公式",
};

export const FORMULA_RESULT_TYPE_LABELS: Record<FormulaResultType, string> = {
  auto: "自动",
  number: "数字",
  text: "文本",
  checkbox: "勾选",
  date: "日期",
};
