import { BATCH_SET_RELATIONS_SCHEMA, type BatchRelationsInput, type BatchRelationsResult } from "@tabdo/shared";
import { db } from "../db/index.js";
import { readRow } from "./relation-reads.js";
import { requireOrgId } from "../tenant/scope.js";
import { prepareBatchRowWrites, updateCellsInTransaction, type OrgScoped } from "./index.js";

async function writeBatchRelations(raw: BatchRelationsInput & OrgScoped, mode: "set" | "add" | "remove"): Promise<BatchRelationsResult> {
  const input = BATCH_SET_RELATIONS_SCHEMA.parse({ relations: raw.relations });
  const scope = { organizationId: requireOrgId(raw.organizationId), actorId: raw.actorId };
  // Multiple fields on one row share one CAS and one version/event write.
  const grouped = new Map<string, { rowId: string; cells: Record<string, string[]>; expectedVersion?: number }>();
  for (const relation of input.relations) {
    const group = grouped.get(relation.rowId) ?? { rowId: relation.rowId, cells: {} };
    if (relation.expectedVersion !== undefined) {
      if (group.expectedVersion !== undefined && group.expectedVersion !== relation.expectedVersion) throw new Error("同一记录的 expectedVersion 必须一致");
      group.expectedVersion = relation.expectedVersion;
    }
    group.cells[relation.columnId] = relation.recordIds;
    grouped.set(relation.rowId, group);
  }
  const updates = [...grouped.values()];
  return db.transaction(async (tx) => {
    const prepared = await prepareBatchRowWrites(tx, updates, scope);
    for (const update of updates) {
      const row = prepared.rowsById.get(update.rowId)!;
      if (update.expectedVersion !== undefined && update.expectedVersion !== row.version)
        throw new Error(`版本冲突: expected ${update.expectedVersion}, got ${row.version}`);
      const cols = prepared.colsByTable.get(row.tableId)!;
      for (const columnId of Object.keys(update.cells)) {
        const column = cols.find((c) => c.id === columnId);
        if (column?.type !== "relation") throw new Error("字段不是关联类型或不属于记录所在表格");
      }
    }
    // CAS was checked against the locked batch-start snapshot. Inverse writes may
    // legitimately advance another input row before its own update in this batch.
    const results = [], affected = new Set<string>();
    for (const update of updates) {
      const result = await updateCellsInTransaction(tx, { ...update, ...scope, expectedVersion: undefined }, mode);
      result.affectedTableIds.forEach((id) => affected.add(id));
    }
    // Later inverse writes can change earlier input rows; return the final batch snapshot.
    for (const update of updates) {
      const row = prepared.rowsById.get(update.rowId)!;
      results.push(await readRow(row.id, prepared.colsByTable.get(row.tableId)!, tx));
    }
    return { count: input.relations.length, rows: results, affectedTableIds: [...affected] };
  });
}
export async function batchSetRelations(input: BatchRelationsInput & OrgScoped) { return writeBatchRelations(input, "set"); }
export async function batchAddRelations(input: BatchRelationsInput & OrgScoped) { return writeBatchRelations(input, "add"); }
export async function batchRemoveRelations(input: BatchRelationsInput & OrgScoped) { return writeBatchRelations(input, "remove"); }
