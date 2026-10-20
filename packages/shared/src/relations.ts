import type { ColumnDef, RelatedRecord, RowData } from "./types.js";
export type RelationWriteInput = {
  rowId: string;
  columnId: string;
  recordIds: string[];
  expectedVersion?: number;
  skipAutomation?: boolean;
};
export type RelationQueryInput = {
  columnId: string;
  rowId?: string;
  mode?: "candidates" | "related";
  recordIds?: string[];
  search?: string;
  cursor?: string | null;
  limit?: number;
};
export type RelationQueryResult = {
  records: (RelatedRecord & { selected: boolean })[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
};
export type GetRowInput = { rowId: string; includeBody?: boolean; bodyFormat?: "json" | "html" };
export type RelationCommands = {
  setRelation: RelationWriteInput;
  addRelation: RelationWriteInput;
  removeRelation: RelationWriteInput;
  queryRelationRecords: RelationQueryInput;
  getRow: GetRowInput;
};
export type RelationResults = {
  setRelation: RowData;
  addRelation: RowData;
  removeRelation: RowData;
  queryRelationRecords: RelationQueryResult;
  getRow: RowData & { columns: ColumnDef[] };
};
