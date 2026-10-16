import type { SiteCommands, SiteResults } from "./sites.js";
import type { BatchAddColumnsInput, BatchUpdateColumnsInput, BatchDeleteColumnsInput, BatchColumnsResult, BatchDeleteColumnsResult } from "./batch-columns.js";
import type { BatchRelationsInput, BatchRelationsResult } from "./batch-relations.js";
import type { RelationCommands, RelationResults } from "./relations.js";
import type { CellValue, ColumnConfig, ColumnType, FullTable, TableMeta, ColumnDef, RowData } from "./types.js";
import type { QueryRowsInput, QueryRowsResult } from "./pagination.js";
import type {
  CreateAutomationInput,
  UpdateAutomationInput,
  ListAutomationsInput,
  DeleteAutomationInput,
  ListAutomationRunsInput,
  AutomationRule,
  AutomationRun,
} from "./automation.js";
import type {
  ListViewsInput,
  GetViewInput,
  DeleteViewInput,
  RenameViewInput,
  SetDefaultViewInput,
  UpdateBoardViewInput,
  CreateFormViewInput,
  CreateGridViewInput,
  CreateBoardViewInput,
  UpdateFormViewInput,
  SetFormFieldsInput,
  AddFormFieldInput,
  RemoveFormFieldInput,
  ReorderFormFieldsInput,
  SetFormSectionsInput,
  SetFormThemeInput,
  SetFormLayoutInput,
  SetFormFieldSettingsInput,
  SetFormChromeInput,
  TableView,
  ResolvedFormView,
} from "./views.js";

/** Shared command names — UI and Agent tools both map here */
export const COMMANDS = [
  "getWorkspace", "listMembers",
  "listSites", "getSite", "saveSite", "restoreSiteRevision", "publishSite", "unpublishSite", "deleteSite",
  "batchAddColumns", "batchUpdateColumns", "batchDeleteColumns", "batchSetRelations", "batchAddRelations", "batchRemoveRelations",
  "getRow", "setRelation", "addRelation", "removeRelation", "queryRelationRecords",
  "listTables",
  "getTable",
  "updateCell",
  "updateCells",
  "addRow",
  "batchAddRows",
  "batchUpdateRows",
  "batchDeleteRows",
  "deleteRow",
  "addColumn",
  "deleteColumn",
  "setStatus",
  "moveCard",
  "queryRows",
  "updateColumn",
  "reorderColumns",
  "listAutomations",
  "createAutomation",
  "updateAutomation",
  "deleteAutomation",
  "listAutomationRuns",
  "listViews",
  "getView",
  "deleteView",
  "renameView",
  "setDefaultView",
  "updateBoardView",
  "createFormView",
  "updateFormView",
  "setFormFields",
  "addFormField",
  "removeFormField",
  "reorderFormFields",
  "setFormSections",
  "createGridView",
  "createBoardView",
  "setFormTheme",
  "setFormLayout",
  "setFormFieldSettings",
  "setFormChrome",
] as const;

export type CommandName = (typeof COMMANDS)[number];

export type ListTablesInput = Record<string, never>;
export type GetTableInput = {
  tableId: string;
  /** if true, also returns first window of rows (discouraged; prefer queryRows) */
  includeFirstPage?: boolean;
};
export type UpdateCellInput = {
  rowId: string;
  columnId: string;
  value: CellValue;
  /** optimistic concurrency: reject if row.version !== expectedVersion */
  expectedVersion?: number;
  /** internal: skip automation engine (writeback from automation itself) */
  skipAutomation?: boolean;
};
export type UpdateCellsInput = {
  rowId: string;
  cells: Record<string, CellValue>;
  expectedVersion?: number;
  skipAutomation?: boolean;
};
export type AddRowInput = {
  tableId: string;
  cells?: Record<string, CellValue>;
  skipAutomation?: boolean;
};
export type BatchAddRowsInput = {
  tableId: string;
  rows: { cells?: Record<string, CellValue> }[];
  /** internal: skip automation engine (writeback from automation itself) */
  skipAutomation?: boolean;
};
export type BatchUpdateRowsInput = {
  updates: { rowId: string; cells: Record<string, CellValue>; expectedVersion?: number }[];
  /** internal: skip automation engine (writeback from automation itself) */
  skipAutomation?: boolean;
};
export type BatchDeleteRowsInput = {
  rowIds: string[];
  /** internal: skip automation engine (writeback from automation itself) */
  skipAutomation?: boolean;
};
export type BatchRowsResult = { count: number; rowIds: string[]; affectedTableIds: string[] };
export type DeleteRowInput = { rowId: string };
export type AddColumnInput = {
  tableId: string;
  name: string;
  type: ColumnType;
  config?: ColumnConfig;
  width?: number;
};
export type DeleteColumnInput = { columnId: string };
/** setStatus / moveCard: set a select column value (kanban column) */
export type SetStatusInput = {
  rowId: string;
  columnId: string;
  statusOptionId: string | null;
};
export type MoveCardInput = SetStatusInput;

export type UpdateColumnInput = {
  columnId: string;
  name?: string;
  type?: ColumnType;
  config?: ColumnConfig;
  width?: number;
  sortOrder?: number;
  hidden?: boolean;
};
export type ReorderColumnsInput = {
  tableId: string;
  columnIds: string[];
};

export type CommandInputMap = SiteCommands & RelationCommands & {
  batchAddColumns: BatchAddColumnsInput;
  batchUpdateColumns: BatchUpdateColumnsInput;
  batchDeleteColumns: BatchDeleteColumnsInput;
  batchSetRelations: BatchRelationsInput;
  batchAddRelations: BatchRelationsInput;
  batchRemoveRelations: BatchRelationsInput;
  queryRows: QueryRowsInput;
  updateColumn: UpdateColumnInput;
  reorderColumns: ReorderColumnsInput;
  listTables: ListTablesInput;
  getTable: GetTableInput;
  updateCell: UpdateCellInput;
  updateCells: UpdateCellsInput;
  addRow: AddRowInput;
  batchAddRows: BatchAddRowsInput;
  batchUpdateRows: BatchUpdateRowsInput;
  batchDeleteRows: BatchDeleteRowsInput;
  deleteRow: DeleteRowInput;
  addColumn: AddColumnInput;
  deleteColumn: DeleteColumnInput;
  setStatus: SetStatusInput;
  moveCard: MoveCardInput;
  listAutomations: ListAutomationsInput;
  createAutomation: CreateAutomationInput;
  updateAutomation: UpdateAutomationInput;
  deleteAutomation: DeleteAutomationInput;
  listAutomationRuns: ListAutomationRunsInput;
  listViews: ListViewsInput;
  getView: GetViewInput;
  deleteView: DeleteViewInput;
  renameView: RenameViewInput;
  setDefaultView: SetDefaultViewInput;
  updateBoardView: UpdateBoardViewInput;
  createFormView: CreateFormViewInput;
  updateFormView: UpdateFormViewInput;
  setFormFields: SetFormFieldsInput;
  addFormField: AddFormFieldInput;
  removeFormField: RemoveFormFieldInput;
  reorderFormFields: ReorderFormFieldsInput;
  setFormSections: SetFormSectionsInput;
  createGridView: CreateGridViewInput;
  createBoardView: CreateBoardViewInput;
  setFormTheme: SetFormThemeInput;
  setFormLayout: SetFormLayoutInput;
  setFormFieldSettings: SetFormFieldSettingsInput;
  setFormChrome: SetFormChromeInput;
};

export type CommandResultMap = SiteResults & RelationResults & {
  batchAddColumns: BatchColumnsResult;
  batchUpdateColumns: BatchColumnsResult;
  batchDeleteColumns: BatchDeleteColumnsResult;
  batchSetRelations: BatchRelationsResult;
  batchAddRelations: BatchRelationsResult;
  batchRemoveRelations: BatchRelationsResult;
  queryRows: QueryRowsResult;
  updateColumn: ColumnDef;
  reorderColumns: ColumnDef[];
  listTables: TableMeta[];
  getTable: FullTable;
  updateCell: RowData;
  updateCells: RowData;
  addRow: RowData;
  batchAddRows: BatchRowsResult;
  batchUpdateRows: BatchRowsResult;
  batchDeleteRows: BatchRowsResult;
  deleteRow: { ok: true };
  addColumn: ColumnDef;
  deleteColumn: { ok: true };
  setStatus: RowData;
  moveCard: RowData;
  listAutomations: AutomationRule[];
  createAutomation: AutomationRule;
  updateAutomation: AutomationRule;
  deleteAutomation: { ok: true };
  listAutomationRuns: AutomationRun[];
  listViews: TableView[];
  getView: TableView | ResolvedFormView;
  deleteView: { ok: true };
  renameView: TableView;
  setDefaultView: TableView;
  updateBoardView: TableView;
  createFormView: ResolvedFormView;
  updateFormView: ResolvedFormView;
  setFormFields: ResolvedFormView;
  addFormField: ResolvedFormView;
  removeFormField: ResolvedFormView;
  reorderFormFields: ResolvedFormView;
  setFormSections: ResolvedFormView;
  createGridView: TableView;
  createBoardView: TableView;
  setFormTheme: ResolvedFormView;
  setFormLayout: ResolvedFormView;
  setFormFieldSettings: ResolvedFormView;
  setFormChrome: ResolvedFormView;
};

export type { QueryRowsInput, QueryRowsResult };

export type {
  ListViewsInput,
  GetViewInput,
  DeleteViewInput,
  RenameViewInput,
  SetDefaultViewInput,
  UpdateBoardViewInput,
  CreateFormViewInput,
  CreateGridViewInput,
  CreateBoardViewInput,
  UpdateFormViewInput,
  SetFormFieldsInput,
  AddFormFieldInput,
  RemoveFormFieldInput,
  ReorderFormFieldsInput,
  SetFormSectionsInput,
  SetFormThemeInput,
  SetFormLayoutInput,
  SetFormFieldSettingsInput,
  SetFormChromeInput,
  TableView,
  ResolvedFormView,
  FormViewConfig,
  FormFieldConfig,
} from "./views.js";
