import { HTTPException } from "hono/http-exception";
import { and, asc, eq, gt, inArray, max, or, sql } from "drizzle-orm";
import { db, inTransaction, type Transaction } from "../db/index.js";
import { columns, rows, tables, tableRelations, COLUMN_TYPES } from "../db/schema.js";
import {
  BATCH_ADD_COLUMNS_SCHEMA, BATCH_UPDATE_COLUMNS_SCHEMA, BATCH_DELETE_COLUMNS_SCHEMA,
  COLUMN_CONFIG_SCHEMA, validateCell, type AddColumnInput, type UpdateColumnInput, type DeleteColumnInput,
  type BatchAddColumnsInput, type BatchUpdateColumnsInput, type BatchDeleteColumnsInput,
  type BatchColumnsResult, type BatchDeleteColumnsResult, type CellValue,
} from "@tabdo/shared";
import { requireOrgId } from "../tenant/scope.js";
import { assertFormulaConfig, loadTableColumns, recomputeFormulasInTransaction } from "./formulas.js";
import { createRelationColumnInTransaction, validateRollup, assertNoRollupDependency } from "./relations.js";

type Scope = { organizationId?: string; actorId?: string };
async function ownedColumn(tx: Transaction, columnId: string, scope: Scope) {
  const [hit] = await tx.select({ column: columns, organizationId: tables.organizationId }).from(columns)
    .innerJoin(tables, eq(tables.id, columns.tableId)).where(eq(columns.id, columnId));
  if (!hit || (scope.organizationId && hit.organizationId !== scope.organizationId)) throw new Error(`列不存在: ${columnId}`);
  return hit.column;
}

/** Schema writers acquire tables and relation definitions in the same order as row batches. */
async function lockSchema(tx: Transaction, tableIds: string[], scope: Scope) {
  const ids = [...new Set(tableIds)].sort();
  const owned = await tx.select().from(tables).where(inArray(tables.id, ids)).orderBy(asc(tables.id)).for("update");
  if (owned.length !== ids.length || (scope.organizationId && owned.some((table) => table.organizationId !== scope.organizationId)))
    throw new Error("表格不存在或不属于该工作区");
  await tx.select().from(tableRelations).where(or(inArray(tableRelations.sourceTableId, ids), inArray(tableRelations.targetTableId, ids)))
    .orderBy(asc(tableRelations.id)).for("update");
  await tx.select().from(columns).where(inArray(columns.tableId, ids)).orderBy(asc(columns.id)).for("update");
}

async function addColumnInTransaction(tx: Transaction, input: AddColumnInput & Scope) {
  const { tableId, name, type, config, width } = input;
  if (!(COLUMN_TYPES as readonly string[]).includes(type)) throw new Error(`不支持的列类型: ${type}`);
  if (type === "relation") return createRelationColumnInTransaction(tx, input);
  let nextConfig = { ...(config ?? {}) };
  if (type === "file") nextConfig.file = COLUMN_CONFIG_SCHEMA.shape.file.parse(nextConfig.file);
  if (type === "rollup") nextConfig.rollup = await validateRollup(tx, tableId, config?.rollup);
  if (type === "formula") {
    assertFormulaConfig(nextConfig, await loadTableColumns(tableId, tx));
    nextConfig = { ...nextConfig, formula: nextConfig.formula?.trim(), formulaResultType: nextConfig.formulaResultType ?? "auto" };
  }
  const [{ position }] = await tx.select({ position: max(columns.sortOrder) }).from(columns).where(eq(columns.tableId, tableId));
  const [column] = await tx.insert(columns).values({ tableId, name, type, config: nextConfig,
    width: width ?? (["formula", "rollup"].includes(type) ? 140 : 160), sortOrder: (position ?? -1) + 1 }).returning();
  if (type === "formula") await recomputeFormulasInTransaction(tableId, tx);
  return { ...column, affectedTableIds: [tableId] };
}
export async function addColumn(input: AddColumnInput & Scope, transaction?: Transaction) {
  return inTransaction(transaction, async (tx) => {
    await lockSchema(tx, [input.tableId, ...(input.type === "relation" && input.config?.relation ? [input.config.relation.targetTableId] : [])], input);
    return addColumnInTransaction(tx, input);
  });
}

async function deleteColumnInTransaction(tx: Transaction, input: DeleteColumnInput & Scope) {
  const column = await ownedColumn(tx, input.columnId, input);
  const defs = await tx.select().from(tableRelations)
    .where(or(eq(tableRelations.sourceColumnId, column.id), eq(tableRelations.inverseColumnId, column.id)))
    .orderBy(asc(tableRelations.id)).for("update");
  const ids = [...new Set([column.id, ...defs.flatMap((d) => [d.sourceColumnId, ...(d.inverseColumnId ? [d.inverseColumnId] : [])])])];
  await tx.select().from(columns).where(inArray(columns.id, ids)).orderBy(asc(columns.id)).for("update");
  await assertNoRollupDependency(ids, tx);
  const affectedTableIds = [...new Set([column.tableId, ...defs.flatMap((d) => [d.sourceTableId, d.targetTableId])])];
  await tx.delete(columns).where(inArray(columns.id, ids));
  for (const tableId of affectedTableIds) await recomputeFormulasInTransaction(tableId, tx);
  return { ok: true as const, affectedTableIds, deletedColumnIds: ids };
}
async function tablesForColumns(tx: Transaction, ids: string[], scope: Scope) {
  const owned = [];
  for (const id of ids) owned.push(await ownedColumn(tx, id, scope));
  const tableIds = [...new Set(owned.map((column) => column.tableId))];
  const defs = await tx.select().from(tableRelations)
    .where(or(inArray(tableRelations.sourceColumnId, ids), inArray(tableRelations.inverseColumnId, ids)));
  return [...new Set([...tableIds, ...defs.flatMap((d) => [d.sourceTableId, d.targetTableId])])];
}
export async function deleteColumn(input: DeleteColumnInput & Scope, transaction?: Transaction) {
  return inTransaction(transaction, async (tx) => {
    await lockSchema(tx, await tablesForColumns(tx, [input.columnId], input), input);
    return deleteColumnInTransaction(tx, input);
  });
}

async function clearIncompatibleCells(tx: Transaction, tableId: string, columnId: string, nextType: string, options?: { id: string }[]) {
  let cursor: string | undefined;
  for (;;) {
    const page = await tx.select().from(rows).where(and(eq(rows.tableId, tableId), cursor ? gt(rows.id, cursor) : undefined))
      .orderBy(asc(rows.id)).limit(500).for("update");
    if (!page.length) break;
    for (const row of page) {
      const value = row.cells?.[columnId];
      if (value === undefined || value === null || value === "" || !validateCell(nextType, value as CellValue, options)) continue;
      await tx.update(rows).set({ cells: { ...(row.cells ?? {}), [columnId]: null }, version: sql`${rows.version}+1`, updatedAt: new Date() }).where(eq(rows.id, row.id));
    }
    cursor = page.at(-1)!.id;
  }
}
async function updateColumnInTransaction(tx: Transaction, input: UpdateColumnInput & Scope) {
  const column = await ownedColumn(tx, input.columnId, input);
  const config = { ...(column.config ?? {}), ...(input.config ?? {}), ...(input.hidden !== undefined ? { hidden: input.hidden } : {}) };
  if (input.type && !(COLUMN_TYPES as readonly string[]).includes(input.type)) throw new Error(`不支持的列类型: ${input.type}`);
  const type = input.type ?? column.type;
  if (type === "file") {
    config.file = COLUMN_CONFIG_SCHEMA.shape.file.parse(config.file);
    if (config.file?.multiple === false) {
      const [multiple] = await tx.select({ id: rows.id }).from(rows).where(and(eq(rows.tableId, column.tableId),
        sql`CASE WHEN jsonb_typeof(${rows.cells} -> ${column.id}) = 'array' THEN jsonb_array_length(${rows.cells} -> ${column.id}) > 1 ELSE false END`)).limit(1);
      if (multiple) throw new HTTPException(400, { message: "已有记录包含多个文件，请先移除多余文件再改为单文件" });
    }
  }
  if (type !== column.type && (["relation", "rollup"].includes(type) || ["relation", "rollup"].includes(column.type)))
    throw new Error("关联和汇总字段不能直接转换类型，请创建新字段");
  if (type !== column.type) await assertNoRollupDependency([column.id], tx);
  if (column.type === "relation" && input.config?.relation && JSON.stringify(input.config.relation) !== JSON.stringify(column.config.relation))
    throw new Error("关联结构不能直接修改，请创建新关联字段");
  if (type === "formula") {
    assertFormulaConfig(config, (await loadTableColumns(column.tableId, tx)).filter((c) => c.id !== column.id), column.id);
    config.formula = config.formula?.trim(); config.formulaResultType = config.formulaResultType ?? "auto";
  }
  if (column.type === "rollup" && input.config?.rollup) config.rollup = await validateRollup(tx, column.tableId, input.config.rollup);
  if (type !== column.type && type !== "formula") await clearIncompatibleCells(tx, column.tableId, column.id, type, config.options);
  const [updated] = await tx.update(columns).set({
    ...(input.name !== undefined ? { name: input.name } : {}), ...(input.type !== undefined ? { type: input.type } : {}), config,
    ...(input.width !== undefined ? { width: input.width } : {}), ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
  }).where(eq(columns.id, column.id)).returning();
  if (type === "formula" || column.type === "formula" || input.name !== undefined || input.config?.formula !== undefined || input.config?.formulaResultType !== undefined)
    await recomputeFormulasInTransaction(column.tableId, tx);
  return updated;
}
export async function updateColumn(input: UpdateColumnInput & Scope, transaction?: Transaction) {
  return inTransaction(transaction, async (tx) => {
    await lockSchema(tx, await tablesForColumns(tx, [input.columnId], input), input);
    return updateColumnInTransaction(tx, input);
  });
}

export async function batchAddColumns(raw: BatchAddColumnsInput & Scope, transaction?: Transaction): Promise<BatchColumnsResult> {
  const input = BATCH_ADD_COLUMNS_SCHEMA.parse({ tableId: raw.tableId, columns: raw.columns });
  const scope = { organizationId: requireOrgId(raw.organizationId), actorId: raw.actorId };
  return inTransaction(transaction, async (tx) => {
    await lockSchema(tx, [input.tableId, ...input.columns.flatMap((c) => c.type === "relation" && c.config?.relation ? [c.config.relation.targetTableId] : [])], scope);
    const added = [], affected = new Set<string>();
    for (const column of input.columns) {
      const result = await addColumnInTransaction(tx, { ...column, tableId: input.tableId, ...scope });
      added.push(result); result.affectedTableIds.forEach((id) => affected.add(id));
    }
    return { count: added.length, columns: added, affectedTableIds: [...affected] };
  });
}
export async function batchUpdateColumns(raw: BatchUpdateColumnsInput & Scope, transaction?: Transaction): Promise<BatchColumnsResult> {
  const input = BATCH_UPDATE_COLUMNS_SCHEMA.parse({ columns: raw.columns });
  const scope = { organizationId: requireOrgId(raw.organizationId), actorId: raw.actorId };
  return inTransaction(transaction, async (tx) => {
    const tableIds = await tablesForColumns(tx, input.columns.map((c) => c.columnId), scope);
    await lockSchema(tx, tableIds, scope);
    const updated = [];
    for (const column of input.columns) updated.push(await updateColumnInTransaction(tx, { ...column, ...scope }));
    return { count: updated.length, columns: updated, affectedTableIds: tableIds };
  });
}
export async function batchDeleteColumns(raw: BatchDeleteColumnsInput & Scope, transaction?: Transaction): Promise<BatchDeleteColumnsResult> {
  const input = BATCH_DELETE_COLUMNS_SCHEMA.parse({ columnIds: raw.columnIds });
  const scope = { organizationId: requireOrgId(raw.organizationId), actorId: raw.actorId };
  return inTransaction(transaction, async (tx) => {
    const tableIds = await tablesForColumns(tx, input.columnIds, scope);
    await lockSchema(tx, tableIds, scope);
    const selected = await tx.select().from(columns).where(inArray(columns.id, input.columnIds));
    // Included rollups are removed before their dependencies; outside dependencies
    // still fail the same check and roll back the entire batch.
    const order = [...input.columnIds].sort((a, b) =>
      Number(selected.find((c) => c.id === b)?.type === "rollup") - Number(selected.find((c) => c.id === a)?.type === "rollup"));
    const deleted = new Set<string>();
    for (const columnId of order) {
      if (deleted.has(columnId)) continue;
      const result = await deleteColumnInTransaction(tx, { columnId, ...scope });
      result.deletedColumnIds.forEach((id) => deleted.add(id));
    }
    return { count: input.columnIds.length, columnIds: input.columnIds, affectedTableIds: tableIds };
  });
}
