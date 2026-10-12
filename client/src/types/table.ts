export type ColumnType =
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "date"
  | "checkbox"
  | "person"
  | "formula";

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
