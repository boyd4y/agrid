export { getWorkspace, listMembers } from "./workspace.js";
import { batchSetRelations, batchAddRelations, batchRemoveRelations } from "./batch-relations.js";
export { batchSetRelations, batchAddRelations, batchRemoveRelations } from "./batch-relations.js";
import { addColumn, updateColumn, deleteColumn, batchAddColumns, batchUpdateColumns, batchDeleteColumns } from "./columns.js";
export { addColumn, updateColumn, deleteColumn, batchAddColumns, batchUpdateColumns, batchDeleteColumns } from "./columns.js";
import { readRow } from "./relation-reads.js";
import { HTTPException } from "hono/http-exception";
import { assertFileReferences } from "../storage/files.js";
import {
  prepareRelationWrites,
  applyRelationWrites,
  affectedTables,
} from "./relations.js";
import { eq, and, asc, max, sql, inArray, or } from "drizzle-orm";
import { getDatabase } from "@tabdo/platform/resources";
import { inTransaction, type Transaction } from "../db/context.js";
import {
  tables,
  columns,
  rows,
  tableRelations,
  rowRelations,
} from "../db/schema.js";
import {
  requireOrgId,
  requireTableInOrg,
  listTablesForOrg,
} from "../tenant/scope.js";
import {
  validateCell,
  DEFAULT_PAGE_SIZE,
  changedColumns,
  type AddRowInput,
  type BatchAddRowsInput,
  type BatchUpdateRowsInput,
  type BatchDeleteRowsInput,
  type BatchRowsResult,
  type DeleteRowInput,
  type GetTableInput,
  type QueryRowsInput,
  type ReorderColumnsInput,
  type SetStatusInput,
  type UpdateCellInput,
  type UpdateCellsInput,
  type CellValue,
  type ColumnDef,
} from "@tabdo/shared";
import { queryRowsWindowed, countTableRows } from "./queryRows.js";
import {
  applyFormulasToCells,
  loadTableColumns,
  recomputeAllFormulasForTable,
} from "./formulas.js";
import { appendAutomationEvent } from "../automation/events.js";
import * as automationCrud from "../automation/crud.js";

export type OrgScoped = { organizationId?: string; actorId?: string };

/** Own-property column lookup — never resolve prototype keys (constructor, toString, __proto__). */
function columnByIdMap<T extends { id: string; type: string }>(
  cols: T[],
): Map<string, T> {
  return new Map(cols.map((c) => [c.id, c]));
}

function requireColumnFromMap<
  T extends { id: string; type: string; name?: string },
>(colMap: Map<string, T>, columnId: string): T {
  const col = colMap.get(columnId);
  if (!col || typeof col !== "object" || typeof col.type !== "string") {
    throw new Error(`列不属于该表: ${columnId}`);
  }
  return col;
}

export async function listTables(input: OrgScoped = {}, transaction?: Transaction) {
  const organizationId = requireOrgId(input.organizationId);
  return listTablesForOrg(organizationId, transaction);
}

/**
 * Schema-only by default (Feishu-class): never dump 100k rows.
 * Optional includeFirstPage returns a small window in `rows`.
 */
export async function getTable({
  tableId,
  includeFirstPage,
  organizationId,
}: GetTableInput & OrgScoped, transaction?: Transaction) {
  const table = await requireTableInOrg(tableId, organizationId, transaction);

  const cols = await (transaction ?? getDatabase())
    .select()
    .from(columns)
    .where(eq(columns.tableId, tableId))
    .orderBy(asc(columns.sortOrder));

  const rowCount = await countTableRows(tableId, transaction);

  let rowList: (typeof rows.$inferSelect)[] = [];
  if (includeFirstPage) {
    const page = await queryRowsWindowed({
      tableId,
      limit: DEFAULT_PAGE_SIZE,
      includeTotal: false,
    }, undefined, transaction);
    rowList = page.rows as typeof rowList;
  }

  return { ...table, columns: cols, rows: rowList, rowCount };
}

/** Create a product table inside an organization (scheme 2). */
export async function createTable(input: {
  organizationId: string;
  name: string;
  description?: string;
}, transaction?: Transaction) {
  const organizationId = requireOrgId(input.organizationId);
  return inTransaction(transaction, async tx => {
    const [table] = await tx.insert(tables).values({ organizationId, name: input.name.trim(), description: input.description }).returning();
    await tx.insert(columns).values({ tableId: table.id, name: "标题", type: "text", sortOrder: 0, width: 220 });
    return table;
  });
}

export async function updateCell(input: UpdateCellInput & OrgScoped, transaction?: Transaction) {
  return updateCells({ ...input, cells: { [input.columnId]: input.value } }, transaction);
}

export async function updateCells(input: UpdateCellsInput & OrgScoped, transaction?: Transaction) {
  return inTransaction(transaction, (tx) => updateCellsInTransaction(tx, input));
}
export async function updateCellsInTransaction(
  tx: Transaction,
  input: UpdateCellsInput & OrgScoped,
  mode: "set" | "add" | "remove" = "set",
) {
  const [hit] = await tx
    .select({ row: rows, table: tables })
    .from(rows)
    .innerJoin(tables, eq(rows.tableId, tables.id))
    .where(eq(rows.id, input.rowId));
  if (
    !hit ||
    (input.organizationId && hit.table.organizationId !== input.organizationId)
  )
    throw new Error("行不存在或不属于该工作区");
  const cols = await loadTableColumns(hit.row.tableId, tx),
    colMap = columnByIdMap(cols);
  for (const [id, value] of Object.entries(input.cells)) {
    const col = requireColumnFromMap(colMap, id);
    if (col.type === "formula" || col.type === "rollup")
      throw new Error(`计算列「${col.name}」只读`);
    const err = validateCell(col.type, value, col.config?.options);
    if (err) {
      const message = `校验失败 (${col.name}): ${err}`;
      if (col.type === "file") throw new HTTPException(400, { message });
      throw new Error(message);
    }
    if (col.type === "file") await assertFileReferences(tx, col, value);
  }
  const { plans, locked } = await prepareRelationWrites(
    tx,
    input.rowId,
    cols,
    input.cells,
    mode,
  );
  const existing = locked.find((r) => r.id === input.rowId);
  if (!existing) throw new Error("记录已删除");
  const casVersion =
    input.expectedVersion ??
    (mode === "set" ? hit.row.version : existing.version);
  if (existing.version !== casVersion)
    throw new Error(
      `版本冲突: expected ${casVersion}, got ${existing.version}`,
    );
  const before = (await readRow(existing.id, cols, tx, true)).cells;
  const ordinary = Object.fromEntries(
    Object.entries(input.cells).filter(
      ([id]) => colMap.get(id)?.type !== "relation",
    ),
  );
  const nextCells = applyFormulasToCells(cols, {
    ...existing.cells,
    ...ordinary,
  });
  const relationChanged = plans.some(
    (p) => JSON.stringify(p.before) !== JSON.stringify(p.after),
  );
  if (!relationChanged && !changedColumns(existing.cells, nextCells).length)
    return { ...(await readRow(existing.id, cols, tx)), affectedTableIds: [] };
  await applyRelationWrites(tx, plans, existing.id, {
    ...input,
    organizationId: hit.table.organizationId,
  });
  const [updated] = await tx
    .update(rows)
    .set({
      cells: nextCells,
      version: sql`${rows.version}+1`,
      updatedAt: new Date(),
    })
    .where(and(eq(rows.id, existing.id), eq(rows.version, casVersion)))
    .returning();
  if (!updated) throw new Error("版本冲突: 记录已变化");
  const resolved = await readRow(existing.id, cols, tx, true);
  if (!input.skipAutomation) {
    const changed = [
      ...new Set([
        ...changedColumns(before, resolved.cells),
        ...plans
          .filter((p) => JSON.stringify(p.before) !== JSON.stringify(p.after))
          .map((p) => p.col.id),
      ]),
    ];
    if (changed.length)
      await appendAutomationEvent(
        tx,
        hit.table.organizationId,
        {
          type: "cells_changed",
          tableId: existing.tableId,
          rowId: existing.id,
          before,
          after: resolved.cells,
          changedColumnIds: changed,
        },
        resolved,
        cols,
        input.actorId,
      );
  }
  return {
    ...(await readRow(existing.id, cols, tx)),
    affectedTableIds: await affectedTables(existing.tableId, tx),
  };
}
async function writeRelation(
  input: import("@tabdo/shared").RelationWriteInput & OrgScoped,
  mode: "set" | "add" | "remove",
  transaction?: Transaction,
) {
  if (!Array.isArray(input.recordIds)) throw new Error("recordIds 必须是数组");
  return inTransaction(transaction, async tx => {
    const [hit] = await tx.select({ column: columns, organizationId: tables.organizationId }).from(columns)
      .innerJoin(tables, eq(columns.tableId, tables.id)).where(eq(columns.id, input.columnId));
    if (!hit || (input.organizationId && hit.organizationId !== input.organizationId) || hit.column.type !== "relation")
      throw new Error("字段不是关联类型或不属于该工作区");
    return updateCellsInTransaction(tx, { ...input, cells: { [input.columnId]: input.recordIds } }, mode);
  });
}
export async function setRelation(input: import("@tabdo/shared").RelationWriteInput & OrgScoped, transaction?: Transaction) {
  return writeRelation(input, "set", transaction);
}
export async function addRelation(input: import("@tabdo/shared").RelationWriteInput & OrgScoped, transaction?: Transaction) {
  return writeRelation(input, "add", transaction);
}
export async function removeRelation(input: import("@tabdo/shared").RelationWriteInput & OrgScoped, transaction?: Transaction) {
  return writeRelation(input, "remove", transaction);
}

/** Serialize appends across single-row and batch callers before reading max order. */
async function prepareRowCreation(
  tx: Transaction,
  input: Pick<AddRowInput, "tableId"> & OrgScoped,
  cellMaps: (Record<string, CellValue> | undefined)[],
) {
  const [table] = await tx.select().from(tables).where(eq(tables.id, input.tableId)).for("update");
  if (!table || (input.organizationId && table.organizationId !== input.organizationId))
    throw new Error(`表格不存在或不属于该工作区: ${input.tableId}`);
  const cols = await loadTableColumns(input.tableId, tx);
  const colMap = columnByIdMap(cols);
  // Acquire every relation definition in one stable order for the whole batch.
  const relationIds = cols.filter((col) => col.type === "relation" && cellMaps.some((cells) => Object.hasOwn(cells ?? {}, col.id)))
    .map((col) => col.config.relation?.relationId).filter((id): id is string => Boolean(id));
  if (relationIds.length)
    await tx.select().from(tableRelations).where(inArray(tableRelations.id, relationIds)).orderBy(asc(tableRelations.id)).for("update");
  const [{ value: maxOrder }] = await tx.select({ value: max(rows.sortOrder) }).from(rows).where(eq(rows.tableId, input.tableId));
  return { table, cols, colMap, nextSortOrder: (maxOrder ?? -1) + 1 };
}

/** Shared transaction body: formulas, relation writes and durable automation events. */
async function addRowInTransaction(
  tx: Transaction,
  input: AddRowInput & OrgScoped,
  context: Awaited<ReturnType<typeof prepareRowCreation>>,
) {
  const { table, cols, colMap } = context;
  for (const [columnId, value] of Object.entries(input.cells ?? {})) {
    const col = requireColumnFromMap(colMap, columnId);
    if (col.type === "formula" || col.type === "rollup")
      throw new Error(`公式列「${col.name}」只读，由表达式自动计算`);
    const err = validateCell(col.type, value, col.config?.options);
    if (err) {
      const message = `校验失败 (${col.name}): ${err}`;
      if (col.type === "file") throw new HTTPException(400, { message });
      throw new Error(message);
    }
    if (col.type === "file") await assertFileReferences(tx, col, value);
  }
  const [row] = await tx.insert(rows).values({
    tableId: input.tableId,
    cells: applyFormulasToCells(cols, Object.fromEntries(Object.entries(input.cells ?? {}).filter(([id]) => colMap.get(id)?.type !== "relation"))),
    sortOrder: context.nextSortOrder++,
    version: 1,
  }).returning();
  const { plans } = await prepareRelationWrites(tx, row.id, cols, input.cells ?? {});
  await applyRelationWrites(tx, plans, row.id, { ...input, organizationId: table.organizationId });
  if (!input.skipAutomation) {
    const resolved = await readRow(row.id, cols, tx, true);
    await appendAutomationEvent(tx, table.organizationId,
      { type: "row_created", tableId: input.tableId, rowId: row.id, cells: resolved.cells },
      resolved, cols, input.actorId);
  }
  return row.id;
}

export async function addRow(input: AddRowInput & OrgScoped, transaction?: Transaction) {
  return inTransaction(transaction, async (tx) => {
    const context = await prepareRowCreation(tx, input, [input.cells]);
    const rowId = await addRowInTransaction(tx, input, context);
    return { ...(await readRow(rowId, context.cols, tx)), affectedTableIds: await affectedTables(input.tableId, tx) };
  });
}

export async function batchAddRows(input: BatchAddRowsInput & OrgScoped, transaction?: Transaction): Promise<BatchRowsResult> {
  if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 100)
    throw new Error("批量新增必须包含 1 至 100 条记录");
  for (const row of input.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
      (row.cells !== undefined && (!row.cells || typeof row.cells !== "object" || Array.isArray(row.cells))))
      throw new Error("批量记录的 cells 必须是字段值对象");
  }
  return inTransaction(transaction, async (tx) => {
    const context = await prepareRowCreation(tx, input, input.rows.map((row) => row.cells));
    const rowIds: string[] = [];
    for (const row of input.rows)
      rowIds.push(await addRowInTransaction(tx, { tableId: input.tableId, cells: row.cells,
        organizationId: input.organizationId, actorId: input.actorId, skipAutomation: input.skipAutomation }, context));
    return { count: rowIds.length, rowIds, affectedTableIds: await affectedTables(input.tableId, tx) };
  });
}

function assertBatchSize(items: unknown, label: string): asserts items is unknown[] {
  if (!Array.isArray(items) || items.length < 1 || items.length > 100)
    throw new Error(`${label}必须包含 1 至 100 项`);
}

function assertUniqueRowIds(ids: string[]) {
  if (ids.some((id) => typeof id !== "string" || !id.trim()) || new Set(ids).size !== ids.length)
    throw new Error("记录 ID 必须有效且不能重复");
}

/** Tables -> relation definitions -> all current/new peer rows, each in stable order. */
export async function prepareBatchRowWrites(
  tx: Transaction,
  updates: readonly { rowId: string; cells?: Record<string, CellValue> }[],
  scope: OrgScoped,
) {
  const rowIds = [...new Set(updates.map((item) => item.rowId))];
  const hits = await tx.select({ row: rows, table: tables }).from(rows).innerJoin(tables, eq(rows.tableId, tables.id)).where(inArray(rows.id, rowIds));
  if (hits.length !== rowIds.length || hits.some((hit) => scope.organizationId && hit.table.organizationId !== scope.organizationId))
    throw new Error("行不存在或不属于该工作区");
  const tableIds = [...new Set(hits.map((hit) => hit.row.tableId))].sort();
  const owned = await tx.select().from(tables).where(inArray(tables.id, tableIds)).orderBy(asc(tables.id)).for("update");
  if (owned.length !== tableIds.length || owned.some((table) => scope.organizationId && table.organizationId !== scope.organizationId))
    throw new Error("表格不存在或不属于该工作区");
  const definitions = await tx.select().from(tableRelations).where(or(inArray(tableRelations.sourceTableId, tableIds), inArray(tableRelations.targetTableId, tableIds))).orderBy(asc(tableRelations.id)).for("update");
  const colsByTable = new Map<string, ColumnDef[]>();
  for (const tableId of tableIds) colsByTable.set(tableId, await loadTableColumns(tableId, tx));
  const edges = await tx.select().from(rowRelations).where(or(inArray(rowRelations.sourceRowId, rowIds), inArray(rowRelations.targetRowId, rowIds)));
  const peers = new Set([...rowIds, ...edges.flatMap((edge) => [edge.sourceRowId, edge.targetRowId])]);
  for (const update of updates) {
    const hit = hits.find((hit) => hit.row.id === update.rowId)!;
    for (const col of colsByTable.get(hit.row.tableId)!) {
      const value = update.cells?.[col.id];
      if (col.type === "relation" && Array.isArray(value))
        for (const id of value) if (typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) peers.add(id);
    }
  }
  const locked = await tx.select().from(rows).where(inArray(rows.id, [...peers].sort())).orderBy(asc(rows.id)).for("update");
  const rowsById = new Map(locked.map((row) => [row.id, row]));
  if (rowIds.some((id) => !rowsById.has(id))) throw new Error("记录已删除");
  return { rowsById, colsByTable, definitions, tablesById: new Map(owned.map((table) => [table.id, table])) };
}

export async function batchUpdateRows(input: BatchUpdateRowsInput & OrgScoped, transaction?: Transaction): Promise<BatchRowsResult> {
  assertBatchSize(input.updates, "批量更新");
  for (const update of input.updates) {
    if (!update || typeof update !== "object" || Array.isArray(update) || !update.cells || typeof update.cells !== "object" || Array.isArray(update.cells) ||
      (update.expectedVersion !== undefined && (!Number.isInteger(update.expectedVersion) || update.expectedVersion < 1)))
      throw new Error("批量更新需要字段值对象与有效版本号");
  }
  assertUniqueRowIds(input.updates.map((update) => update.rowId));
  return inTransaction(transaction, async (tx) => {
    const prepared = await prepareBatchRowWrites(tx, input.updates, input);
    // Verify the caller's versions against the same locked initial state.
    // Earlier inverse writes in this batch may then legitimately bump a later
    // input row; the shared helper reads its current transaction version.
    for (const update of input.updates) {
      const original = prepared.rowsById.get(update.rowId)!;
      if (update.expectedVersion !== undefined && update.expectedVersion !== original.version)
        throw new Error(`版本冲突: expected ${update.expectedVersion}, got ${original.version}`);
    }
    const affected = new Set<string>();
    for (const update of input.updates) {
      const result = await updateCellsInTransaction(tx, { rowId: update.rowId, cells: update.cells,
        organizationId: input.organizationId, actorId: input.actorId, skipAutomation: input.skipAutomation });
      for (const id of result.affectedTableIds) affected.add(id);
    }
    return { count: input.updates.length, rowIds: input.updates.map((update) => update.rowId), affectedTableIds: [...affected] };
  });
}

async function deleteRowInTransaction(
  tx: Transaction,
  input: DeleteRowInput & OrgScoped & { skipAutomation?: boolean },
  prepared: Awaited<ReturnType<typeof prepareBatchRowWrites>>,
) {
  const row = prepared.rowsById.get(input.rowId)!;
  const context = { table: prepared.tablesById.get(row.tableId)! };
  const cols = prepared.colsByTable.get(row.tableId)!;
  const defs = prepared.definitions.filter((definition) => definition.sourceTableId === row.tableId || definition.targetTableId === row.tableId);
  const incoming: ColumnDef[] = defs
    .filter((d) => d.targetTableId === row.tableId && !d.inverseColumnId)
    .map((d) => ({
      id: d.id,
      tableId: row.tableId,
      name: "反向关联",
      type: "relation",
      width: 220,
      sortOrder: 0,
      createdAt: new Date(),
      config: {
        relation: {
          relationId: d.id,
          direction: "target",
          targetTableId: d.sourceTableId,
          limit: d.targetSingle ? "one" : "many",
        },
      },
    }));
  const deleteCols = [...cols, ...incoming];
  const values = Object.fromEntries(
    deleteCols.filter((c) => c.type === "relation").map((c) => [c.id, []]),
  );
  const { plans } = await prepareRelationWrites(
    tx,
    input.rowId,
    deleteCols,
    values,
  );
  await applyRelationWrites(tx, plans, input.rowId, {
    organizationId: context.table.organizationId,
    actorId: input.actorId,
    skipAutomation: input.skipAutomation,
  });
  const deleted = await tx.delete(rows).where(eq(rows.id, input.rowId)).returning();
  if (!deleted.length) throw new Error("行不存在");
}

export async function deleteRow(input: DeleteRowInput & OrgScoped, transaction?: Transaction) {
  return inTransaction(transaction, async (tx) => {
    const prepared = await prepareBatchRowWrites(tx, [{ rowId: input.rowId }], input);
    const row = prepared.rowsById.get(input.rowId)!;
    await deleteRowInTransaction(tx, input, prepared);
    return { ok: true as const, affectedTableIds: await affectedTables(row.tableId, tx) };
  });
}

export async function batchDeleteRows(input: BatchDeleteRowsInput & OrgScoped, transaction?: Transaction): Promise<BatchRowsResult> {
  assertBatchSize(input.rowIds, "批量删除");
  assertUniqueRowIds(input.rowIds);
  return inTransaction(transaction, async (tx) => {
    const prepared = await prepareBatchRowWrites(tx, input.rowIds.map((rowId) => ({ rowId })), input);
    const affected = new Set<string>();
    for (const rowId of input.rowIds) {
      const row = prepared.rowsById.get(rowId)!;
      await deleteRowInTransaction(tx, { rowId, organizationId: input.organizationId, actorId: input.actorId, skipAutomation: input.skipAutomation }, prepared);
      for (const id of await affectedTables(row.tableId, tx)) affected.add(id);
    }
    return { count: input.rowIds.length, rowIds: [...input.rowIds], affectedTableIds: [...affected] };
  });
}

export async function deleteTable(input: { tableId: string } & OrgScoped) {
  return getDatabase().transaction(async (tx) => {
    const [table] = await tx
      .select()
      .from(tables)
      .where(eq(tables.id, input.tableId))
      .for("update");
    if (!table || table.organizationId !== input.organizationId)
      throw new Error("表格不存在");
    const dependencies = await tx
      .select()
      .from(tableRelations)
      .where(
        or(
          eq(tableRelations.sourceTableId, table.id),
          eq(tableRelations.targetTableId, table.id),
        ),
      );
    if (dependencies.length)
      throw new Error("表格存在关联字段，请先删除关联字段，再删除表格");
    await tx.delete(tables).where(eq(tables.id, table.id));
    return { ok: true as const };
  });
}

export async function reorderColumns(input: ReorderColumnsInput & OrgScoped, transaction?: Transaction) {
  return inTransaction(transaction, async tx => {
    const [table] = await tx.select().from(tables).where(eq(tables.id, input.tableId)).for("update");
    if (!table || (input.organizationId && table.organizationId !== input.organizationId)) throw new Error("表格不存在");
    const existing = await tx.select().from(columns).where(eq(columns.tableId, input.tableId)).orderBy(asc(columns.sortOrder)).for("update");
    const idSet = new Set(existing.map(column => column.id));
    if (new Set(input.columnIds).size !== input.columnIds.length) throw new Error("字段不能重复");
    for (const id of input.columnIds) if (!idSet.has(id)) throw new Error(`列不属于该表: ${id}`);
    const order = [...input.columnIds, ...existing.map(column => column.id).filter(id => !input.columnIds.includes(id))];
    const updated = [];
    for (const [sortOrder, id] of order.entries()) {
      const [column] = await tx.update(columns).set({ sortOrder }).where(eq(columns.id, id)).returning();
      updated.push(column);
    }
    return updated;
  });
}

/** Windowed query — SQL filter pushdown + keyset cursor. Never returns unbounded rows. */
export async function queryRows(input: QueryRowsInput & OrgScoped, transaction?: Transaction) {
  await requireTableInOrg(input.tableId, input.organizationId, transaction);
  return queryRowsWindowed(input, undefined, transaction);
}

export async function setStatus(input: SetStatusInput & OrgScoped & { skipAutomation?: boolean }, transaction?: Transaction) {
  return updateCell({ ...input, value: input.statusOptionId }, transaction);
}

export const moveCard = setStatus;

export { countTableRows, queryRowsWindowed, recomputeAllFormulasForTable };

export const listAutomations = automationCrud.listAutomations;
export const createAutomation = automationCrud.createAutomation;
export const updateAutomation = automationCrud.updateAutomation;
export const deleteAutomation = automationCrud.deleteAutomation;
export const listAutomationRuns = automationCrud.listAutomationRuns;

export {
  listViews,
  getView,
  deleteView,
  renameView,
  setDefaultView,
  updateBoardView,
  createFormView,
  createGridView,
  createBoardView,
  updateFormView,
  setFormFields,
  addFormField,
  removeFormField,
  reorderFormFields,
  setFormSections,
  setFormTheme,
  setFormLayout,
  setFormFieldSettings,
  setFormChrome,
  ensureDemoFormView,
} from "./views.js";
import * as viewCmds from "./views.js";

export { getRow, queryRelationRecords } from "./relations.js";
import { getRow, queryRelationRecords } from "./relations.js";

export const commands = {
  batchSetRelations,
  batchAddRelations,
  batchRemoveRelations,
  batchAddColumns,
  batchUpdateColumns,
  batchDeleteColumns,
  getRow,
  setRelation,
  addRelation,
  removeRelation,
  queryRelationRecords,
  listTables,
  getTable,
  createTable,
  updateCell,
  updateCells,
  addRow,
  batchAddRows,
  batchUpdateRows,
  batchDeleteRows,
  deleteRow,
  addColumn,
  deleteColumn,
  updateColumn,
  reorderColumns,
  queryRows,
  setStatus,
  moveCard,
  listAutomations,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  listAutomationRuns,
  listViews: viewCmds.listViews,
  getView: viewCmds.getView,
  deleteView: viewCmds.deleteView,
  renameView: viewCmds.renameView,
  setDefaultView: viewCmds.setDefaultView,
  updateBoardView: viewCmds.updateBoardView,
  createFormView: viewCmds.createFormView,
  createGridView: viewCmds.createGridView,
  createBoardView: viewCmds.createBoardView,
  updateFormView: viewCmds.updateFormView,
  setFormFields: viewCmds.setFormFields,
  addFormField: viewCmds.addFormField,
  removeFormField: viewCmds.removeFormField,
  reorderFormFields: viewCmds.reorderFormFields,
  setFormSections: viewCmds.setFormSections,
  setFormTheme: viewCmds.setFormTheme,
  setFormLayout: viewCmds.setFormLayout,
  setFormFieldSettings: viewCmds.setFormFieldSettings,
  setFormChrome: viewCmds.setFormChrome,
};
