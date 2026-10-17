export const COLUMN_TYPES = [
  "text",
  "number",
  "select",
  "multi_select",
  "file",
  "date",
  "checkbox",
  "person",
  "formula",
  "relation",
  "rollup",
] as const;

export type ColumnType = (typeof COLUMN_TYPES)[number];

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

export type StoredFile = { id: string; name: string; size: number; mimeType: string; createdAt: string };

export type ColumnConfig = {
  /** File cells store uploaded file IDs; multiple defaults to true. */
  file?: { multiple?: boolean };
  relation?: RelationConfig;
  rollup?: RollupConfig;
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

/** Known Lucide identifiers for the picker and renderer; persisted names remain open. */
export const TABLE_ICON_NAMES = [
  "Table2",
  "Database",
  "Folder",
  "Files",
  "FileText",
  "Archive",
  "Inbox",
  "Bookmark",
  "Star",
  "Flag",
  "Tag",
  "Hash",
  "Circle",
  "Square",
  "Triangle",
  "Layers",
  "LayoutDashboard",
  "LayoutGrid",
  "BriefcaseBusiness",
  "Building2",
  "CalendarDays",
  "CheckSquare",
  "ListTodo",
  "Kanban",
  "ChartNoAxesCombined",
  "ChartPie",
  "ChartColumn",
  "Wallet",
  "CreditCard",
  "Receipt",
  "ShoppingCart",
  "Package",
  "Truck",
  "Target",
  "Milestone",
  "ClipboardList",
  "Presentation",
  "Timer",
  "Users",
  "UserRound",
  "Contact",
  "UserRoundPlus",
  "Handshake",
  "MessageCircle",
  "MessagesSquare",
  "Mail",
  "Phone",
  "Megaphone",
  "Bell",
  "HeartHandshake",
  "Smile",
  "ThumbsUp",
  "Award",
  "Gift",
  "BookOpen",
  "GraduationCap",
  "Library",
  "NotebookPen",
  "Pencil",
  "PenTool",
  "Lightbulb",
  "Brain",
  "Search",
  "FlaskConical",
  "Microscope",
  "Languages",
  "Calculator",
  "FileSearch",
  "Quote",
  "Puzzle",
  "Palette",
  "Paintbrush",
  "Music",
  "Camera",
  "Image",
  "Video",
  "Clapperboard",
  "Mic",
  "Headphones",
  "Radio",
  "Scissors",
  "WandSparkles",
  "Sparkles",
  "Feather",
  "Film",
  "Piano",
  "Globe",
  "MapPin",
  "Plane",
  "Map",
  "Compass",
  "Route",
  "Luggage",
  "TrainFront",
  "Bus",
  "Car",
  "Bike",
  "Ship",
  "Tent",
  "Mountain",
  "Waves",
  "Sun",
  "Cloud",
  "Umbrella",
  "Heart",
  "Coffee",
  "House",
  "Utensils",
  "CookingPot",
  "Apple",
  "Cake",
  "Flower2",
  "Leaf",
  "TreePine",
  "Sprout",
  "Dog",
  "Cat",
  "PawPrint",
  "Dumbbell",
  "Footprints",
  "Bed",
  "Moon",
  "Activity",
  "Gamepad2",
  "Code",
  "Cpu",
  "Rocket",
  "Laptop",
  "Monitor",
  "Smartphone",
  "Keyboard",
  "Mouse",
  "Bot",
  "Workflow",
  "GitBranch",
  "Terminal",
  "Braces",
  "Bug",
  "Wrench",
  "Settings2",
  "Shield",
  "LockKeyhole",
  "Wifi",
  "HardDrive",
] as const;

export type TableIconName = typeof TABLE_ICON_NAMES[number];

export type TableMeta = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  icon?: string | null;
  pinned?: boolean;
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
  relations?: Record<string, { records: RelatedRecord[]; total: number }>;
  affectedTableIds?: string[];
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
  file: "文件",
  date: "日期",
  checkbox: "勾选",
  person: "人员",
  formula: "公式",
  relation: "关联",
  rollup: "汇总",
};

export const FORMULA_RESULT_TYPE_LABELS: Record<FormulaResultType, string> = {
  auto: "自动",
  number: "数字",
  text: "文本",
  checkbox: "勾选",
  date: "日期",
};
