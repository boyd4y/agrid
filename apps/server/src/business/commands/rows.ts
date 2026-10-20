import { deleteSite } from "../sites/service.js";
import { readRowBody, writeRowBody, withRowReceipt } from "./row-body.js";
import { requireUnpublishedBlogSource } from "../blogs/source-deletion.js";
import { workspaceMatches, requireWorkspace } from "../tenant/workspace.js";
import type { CommandDependencies } from "../dependencies.js";
import { readRow } from "./relation-reads.js";
import { ServiceError } from "../errors.js";
import { assertFileReferences } from "../storage/files.js";
import {
  prepareRelationWrites,
  applyRelationWrites,
  affectedTables,
} from "./relations.js";
import { eq, and, asc, max, sql, inArray, or } from "drizzle-orm";

import { inTransaction, type Transaction } from "../db/context.js";
import {
  tables,
  columns,
  rows,
  tableRelations,
  rowRelations,
  tableViews,
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

export type OrgScoped = { organizationId?: string; actorId?: string; receiptPrincipalId?: string };

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

export async function listTables(deps: CommandDependencies, input: OrgScoped = {}, transaction?: Transaction) {
  const organizationId = requireOrgId(input.organizationId);
  return listTablesForOrg(deps, organizationId, transaction);
}

/**
 * Schema-only by default (Feishu-class): never dump 100k rows.
 * Optional includeFirstPage returns a small window in `rows`.
 */
export async function getTable(deps: CommandDependencies, {
  tableId,
  includeFirstPage,
  organizationId,
}: GetTableInput & OrgScoped, transaction?: Transaction) {
  const table = await requireTableInOrg(deps, tableId, organizationId, transaction);

  const cols = await (transaction ?? deps.database)
    .select()
    .from(columns)
    .where(eq(columns.tableId, tableId))
    .orderBy(asc(columns.sortOrder));

  const rowCount = await countTableRows(deps, tableId, transaction);

  let rowList: (typeof rows.$inferSelect)[] = [];
  if (includeFirstPage) {
    const page = await queryRowsWindowed(deps, {
      tableId,
      limit: DEFAULT_PAGE_SIZE,
      includeTotal: false,
    }, undefined, transaction);
    rowList = page.rows as typeof rowList;
  }

  return { ...table, columns: cols, rows: rowList, rowCount };
}

/** Create a product table inside an organization (scheme 2). */
export async function createTable(deps: CommandDependencies, input: {
  organizationId: string;
  name: string;
  description?: string;
}, transaction?: Transaction) {
  const organizationId = requireOrgId(input.organizationId);
  return inTransaction(deps, transaction, async tx => {
    const [table] = await tx.insert(tables).values({ organizationId, workspaceId: (await requireWorkspace(deps, organizationId, tx)).id, name: input.name.trim(), description: input.description }).returning();
    await tx.insert(columns).values({ tableId: table.id, name: "标题", type: "text", sortOrder: 0, width: 220 });
    return table;
  });
}

export async function updateCell(deps: CommandDependencies, input: UpdateCellInput & OrgScoped, transaction?: Transaction) {
  return updateCells(deps, { ...input, cells: { [input.columnId]: input.value } }, transaction);
}

export async function updateCells(deps: CommandDependencies, input: UpdateCellsInput & OrgScoped, transaction?: Transaction): Promise<Awaited<ReturnType<typeof updateCellsInTransaction>> & { bodyVersion?: number }> {
  return inTransaction(deps, transaction, root => root.transaction(async tx => {
    if (!input.body) return updateCellsInTransaction(deps, tx, input);
    const hit = await import("../tenant/scope.js").then(m => m.requireRowInOrg(deps, input.rowId, input.organizationId, tx));
    return withRowReceipt(tx, { workspaceId: hit.workspaceId, principalId: input.receiptPrincipalId ?? `user:${input.actorId ?? input.organizationId}` }, "updateCells", input, async () => {
      const saved = await updateCellsInTransaction(deps, tx, { ...input, cells: input.cells ?? {} });
      const bodyVersion = await writeRowBody(deps, tx, { id: input.rowId, tableId: hit.tableId, workspaceId: hit.workspaceId, organizationId: hit.organizationId }, input.body!);
      // Body CAS is independent of cell CAS, but both modify the owning record.
      const [touched] = await tx.update(rows).set({ updatedAt: deps.now() }).where(eq(rows.id, input.rowId)).returning({ updatedAt: rows.updatedAt });
      return { ...saved, updatedAt: touched.updatedAt, bodyVersion, affectedTableIds: await affectedTables(deps, hit.tableId, tx) };
    });
  }));
}
export async function updateCellsInTransaction(
  deps: CommandDependencies,
  tx: Transaction,
  input: UpdateCellsInput & OrgScoped,
  mode: "set" | "add" | "remove" = "set",
) {
  requireOrgId(input.organizationId);
  const [hit] = await tx
    .select({ row: rows, table: tables })
    .from(rows)
    .innerJoin(tables, eq(rows.tableId, tables.id))
    .where(eq(rows.id, input.rowId));
  if (
    !hit ||
    ((input.organizationId && hit.table.organizationId !== input.organizationId) || !(await workspaceMatches(deps, hit.table, tx)))
  )
    throw new Error("行不存在或不属于该工作区");
  const cols = await loadTableColumns(deps, hit.row.tableId, tx),
    colMap = columnByIdMap(cols);
  for (const [id, value] of Object.entries(input.cells ?? {})) {
    const col = requireColumnFromMap(colMap, id);
    if (col.type === "formula" || col.type === "rollup")
      throw new Error(`计算列「${col.name}」只读`);
    const err = validateCell(col.type, value, col.config?.options);
    if (err) {
      const message = `校验失败 (${col.name}): ${err}`;
      if (col.type === "file") throw new ServiceError(400, { message });
      throw new Error(message);
    }
    if (col.type === "file") await assertFileReferences(deps, tx, col, value);
  }
  const { plans, locked } = await prepareRelationWrites(
    deps, tx,
    input.rowId,
    cols,
    input.cells ?? {},
    mode,
  );
  const existing = locked.find((r) => r.id === input.rowId);
  if (!existing) throw new Error("记录已删除");
  const casVersion =
    input.expectedVersion ??
    (mode === "set" && Object.keys(input.cells ?? {}).length ? hit.row.version : existing.version);
  if (existing.version !== casVersion)
    throw new Error(
      `版本冲突: expected ${casVersion}, got ${existing.version}`,
    );
  const before = (await readRow(deps, existing.id, cols, tx, true)).cells;
  const ordinary = Object.fromEntries(
    Object.entries(input.cells ?? {}).filter(
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
    return { ...(await readRow(deps, existing.id, cols, tx)), affectedTableIds: [] };
  await applyRelationWrites(deps, tx, plans, existing.id, {
    ...input,
    organizationId: hit.table.organizationId,
  });
  const [updated] = await tx
    .update(rows)
    .set({
      cells: nextCells,
      version: sql`${rows.version}+1`,
      updatedAt: deps.now(),
    })
    .where(and(eq(rows.id, existing.id), eq(rows.version, casVersion)))
    .returning();
  if (!updated) throw new Error("版本冲突: 记录已变化");
  const resolved = await readRow(deps, existing.id, cols, tx, true);
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
        deps, tx,
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
    ...(await readRow(deps, existing.id, cols, tx)),
    affectedTableIds: await affectedTables(deps, existing.tableId, tx),
  };
}
async function writeRelation(
  deps: CommandDependencies,
  input: import("@tabdo/shared").RelationWriteInput & OrgScoped,
  mode: "set" | "add" | "remove",
  transaction?: Transaction,
) {
  if (!Array.isArray(input.recordIds)) throw new Error("recordIds 必须是数组");
  return inTransaction(deps, transaction, async tx => {
    const [hit] = await tx.select({ column: columns, organizationId: tables.organizationId, workspaceId: tables.workspaceId }).from(columns)
      .innerJoin(tables, eq(columns.tableId, tables.id)).where(eq(columns.id, input.columnId));
    if (!hit || ((input.organizationId && hit.organizationId !== input.organizationId) || !(await workspaceMatches(deps, hit, tx))) || hit.column.type !== "relation")
      throw new Error("字段不是关联类型或不属于该工作区");
    return updateCellsInTransaction(deps, tx, { ...input, cells: { [input.columnId]: input.recordIds } }, mode);
  });
}
export async function setRelation(deps: CommandDependencies, input: import("@tabdo/shared").RelationWriteInput & OrgScoped, transaction?: Transaction) {
  return writeRelation(deps, input, "set", transaction);
}
export async function addRelation(deps: CommandDependencies, input: import("@tabdo/shared").RelationWriteInput & OrgScoped, transaction?: Transaction) {
  return writeRelation(deps, input, "add", transaction);
}
export async function removeRelation(deps: CommandDependencies, input: import("@tabdo/shared").RelationWriteInput & OrgScoped, transaction?: Transaction) {
  return writeRelation(deps, input, "remove", transaction);
}

/** Serialize appends across single-row and batch callers before reading max order. */
async function prepareRowCreation(
  deps: CommandDependencies,
  tx: Transaction,
  input: Pick<AddRowInput, "tableId"> & OrgScoped,
  cellMaps: (Record<string, CellValue> | undefined)[],
) {
  requireOrgId(input.organizationId);
  const [table] = await tx.select().from(tables).where(eq(tables.id, input.tableId)).for("update");
  if (!table || ((input.organizationId && table.organizationId !== input.organizationId) || !(await workspaceMatches(deps, table, tx))))
    throw new Error(`表格不存在或不属于该工作区: ${input.tableId}`);
  const cols = await loadTableColumns(deps, input.tableId, tx);
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
  deps: CommandDependencies,
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
      if (col.type === "file") throw new ServiceError(400, { message });
      throw new Error(message);
    }
    if (col.type === "file") await assertFileReferences(deps, tx, col, value);
  }
  const [row] = await tx.insert(rows).values({
    tableId: input.tableId,
    cells: applyFormulasToCells(cols, Object.fromEntries(Object.entries(input.cells ?? {}).filter(([id]) => colMap.get(id)?.type !== "relation"))),
    sortOrder: context.nextSortOrder++,
    version: 1,
  }).returning();
  const { plans } = await prepareRelationWrites(deps, tx, row.id, cols, input.cells ?? {});
  await applyRelationWrites(deps, tx, plans, row.id, { ...input, organizationId: table.organizationId });
  if (!input.skipAutomation) {
    const resolved = await readRow(deps, row.id, cols, tx, true);
    await appendAutomationEvent(deps, tx, table.organizationId,
      { type: "row_created", tableId: input.tableId, rowId: row.id, cells: resolved.cells },
      resolved, cols, input.actorId);
  }
  return row.id;
}

export async function addRow(deps: CommandDependencies, input: AddRowInput & OrgScoped, transaction?: Transaction) {
  return inTransaction(deps, transaction, root => root.transaction(async tx => {
    const context = await prepareRowCreation(deps, tx, input, [input.cells]);
    const work = async () => {
      const rowId = await addRowInTransaction(deps, tx, input, context);
      const bodyVersion = input.body ? await writeRowBody(deps, tx, { id: rowId, tableId: input.tableId, workspaceId: context.table.workspaceId, organizationId: context.table.organizationId }, { ...input.body, expectedVersion: 0 }) : undefined;
      return { ...(await readRow(deps, rowId, context.cols, tx)), ...(bodyVersion !== undefined ? { bodyVersion } : {}), affectedTableIds: await affectedTables(deps, input.tableId, tx) };
    };
    return input.body ? withRowReceipt(tx, { workspaceId: context.table.workspaceId, principalId: input.receiptPrincipalId ?? `user:${input.actorId ?? input.organizationId}` }, "addRow", input, work) : work();
  }));
}

export async function batchAddRows(deps: CommandDependencies, input: BatchAddRowsInput & OrgScoped, transaction?: Transaction): Promise<BatchRowsResult> {
  if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 100)
    throw new Error("批量新增必须包含 1 至 100 条记录");
  for (const row of input.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
      (row.cells !== undefined && (!row.cells || typeof row.cells !== "object" || Array.isArray(row.cells))))
      throw new Error("批量记录的 cells 必须是字段值对象");
  }
  return inTransaction(deps, transaction, async (tx) => {
    const context = await prepareRowCreation(deps, tx, input, input.rows.map((row) => row.cells));
    const rowIds: string[] = [];
    for (const row of input.rows)
      rowIds.push(await addRowInTransaction(deps, tx, { tableId: input.tableId, cells: row.cells,
        organizationId: input.organizationId, actorId: input.actorId, skipAutomation: input.skipAutomation }, context));
    return { count: rowIds.length, rowIds, affectedTableIds: await affectedTables(deps, input.tableId, tx) };
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
  deps: CommandDependencies,
  tx: Transaction,
  updates: readonly { rowId: string; cells?: Record<string, CellValue> }[],
  scope: OrgScoped,
) {
  const workspaceId = (await requireWorkspace(deps, requireOrgId(scope.organizationId), tx)).id;
  const rowIds = [...new Set(updates.map((item) => item.rowId))];
  const hits = await tx.select({ row: rows, table: tables }).from(rows).innerJoin(tables, eq(rows.tableId, tables.id)).where(inArray(rows.id, rowIds));
  if (hits.length !== rowIds.length || hits.some((hit) => hit.table.organizationId !== scope.organizationId || hit.table.workspaceId !== workspaceId))
    throw new Error("行不存在或不属于该工作区");
  const tableIds = [...new Set(hits.map((hit) => hit.row.tableId))].sort();
  const owned = await tx.select().from(tables).where(inArray(tables.id, tableIds)).orderBy(asc(tables.id)).for("update");
  if (owned.length !== tableIds.length || owned.some((table) => table.organizationId !== scope.organizationId || table.workspaceId !== workspaceId))
    throw new Error("表格不存在或不属于该工作区");
  const definitions = await tx.select().from(tableRelations).where(or(inArray(tableRelations.sourceTableId, tableIds), inArray(tableRelations.targetTableId, tableIds))).orderBy(asc(tableRelations.id)).for("update");
  const colsByTable = new Map<string, ColumnDef[]>();
  for (const tableId of tableIds) colsByTable.set(tableId, await loadTableColumns(deps, tableId, tx));
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

export async function batchUpdateRows(deps: CommandDependencies, input: BatchUpdateRowsInput & OrgScoped, transaction?: Transaction): Promise<BatchRowsResult> {
  assertBatchSize(input.updates, "批量更新");
  for (const update of input.updates) {
    if (!update || typeof update !== "object" || Array.isArray(update) || !update.cells || typeof update.cells !== "object" || Array.isArray(update.cells) ||
      (update.expectedVersion !== undefined && (!Number.isInteger(update.expectedVersion) || update.expectedVersion < 1)))
      throw new Error("批量更新需要字段值对象与有效版本号");
  }
  assertUniqueRowIds(input.updates.map((update) => update.rowId));
  return inTransaction(deps, transaction, async (tx) => {
    const prepared = await prepareBatchRowWrites(deps, tx, input.updates, input);
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
      const result = await updateCellsInTransaction(deps, tx, { rowId: update.rowId, cells: update.cells,
        organizationId: input.organizationId, actorId: input.actorId, skipAutomation: input.skipAutomation });
      for (const id of result.affectedTableIds) affected.add(id);
    }
    return { count: input.updates.length, rowIds: input.updates.map((update) => update.rowId), affectedTableIds: [...affected] };
  });
}

async function deleteRowInTransaction(
  deps: CommandDependencies,
  tx: Transaction,
  input: DeleteRowInput & OrgScoped & { skipAutomation?: boolean },
  prepared: Awaited<ReturnType<typeof prepareBatchRowWrites>>,
) {
  const row = prepared.rowsById.get(input.rowId)!;
  await requireUnpublishedBlogSource(tx, row.tableId, row.id);
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
      createdAt: deps.now(),
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
    deps, tx,
    input.rowId,
    deleteCols,
    values,
  );
  await applyRelationWrites(deps, tx, plans, input.rowId, {
    organizationId: context.table.organizationId,
    actorId: input.actorId,
    skipAutomation: input.skipAutomation,
  });
  const deleted = await tx.delete(rows).where(eq(rows.id, input.rowId)).returning();
  if (!deleted.length) throw new Error("行不存在");
}

export async function deleteRow(deps: CommandDependencies, input: DeleteRowInput & OrgScoped, transaction?: Transaction) {
  return inTransaction(deps, transaction, async (tx) => {
    const prepared = await prepareBatchRowWrites(deps, tx, [{ rowId: input.rowId }], input);
    const row = prepared.rowsById.get(input.rowId)!;
    await deleteRowInTransaction(deps, tx, input, prepared);
    return { ok: true as const, affectedTableIds: await affectedTables(deps, row.tableId, tx) };
  });
}

export async function batchDeleteRows(deps: CommandDependencies, input: BatchDeleteRowsInput & OrgScoped, transaction?: Transaction): Promise<BatchRowsResult> {
  assertBatchSize(input.rowIds, "批量删除");
  assertUniqueRowIds(input.rowIds);
  return inTransaction(deps, transaction, async (tx) => {
    const prepared = await prepareBatchRowWrites(deps, tx, input.rowIds.map((rowId) => ({ rowId })), input);
    // Preflight the entire batch before deleting any row, including in a host transaction.
    for (const rowId of input.rowIds) {
      const row = prepared.rowsById.get(rowId)!;
      await requireUnpublishedBlogSource(tx, row.tableId, row.id);
    }
    const affected = new Set<string>();
    for (const rowId of input.rowIds) {
      const row = prepared.rowsById.get(rowId)!;
      await deleteRowInTransaction(deps, tx, { rowId, organizationId: input.organizationId, actorId: input.actorId, skipAutomation: input.skipAutomation }, prepared);
      for (const id of await affectedTables(deps, row.tableId, tx)) affected.add(id);
    }
    return { count: input.rowIds.length, rowIds: [...input.rowIds], affectedTableIds: [...affected] };
  });
}

export async function deleteTable(deps: CommandDependencies, input: { tableId: string } & OrgScoped, transaction?: Transaction) {
  return inTransaction(deps, transaction,async (tx) => {
    const [table] = await tx
      .select()
      .from(tables)
      .where(eq(tables.id, input.tableId))
      .for("update");
    if (!table || table.organizationId !== input.organizationId || !(await workspaceMatches(deps, table, tx)))
      throw new Error("表格不存在");
    await requireUnpublishedBlogSource(tx, table.id);
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
    const linked = await tx.select().from(tableViews).where(eq(tableViews.tableId, table.id));
    await tx.delete(tableViews).where(eq(tableViews.tableId, table.id));
    for (const view of linked) if (view.siteId) await deleteSite(deps, { siteId: view.siteId, organizationId: input.organizationId }, tx);
    await tx.delete(tables).where(eq(tables.id, table.id));
    return { ok: true as const };
  });
}

export async function reorderColumns(deps: CommandDependencies, input: ReorderColumnsInput & OrgScoped, transaction?: Transaction) {
  return inTransaction(deps, transaction, async tx => {
    requireOrgId(input.organizationId);
    const [table] = await tx.select().from(tables).where(eq(tables.id, input.tableId)).for("update");
    if (!table || ((input.organizationId && table.organizationId !== input.organizationId) || !(await workspaceMatches(deps, table, tx)))) throw new Error("表格不存在");
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
export async function queryRows(deps: CommandDependencies, input: QueryRowsInput & OrgScoped, transaction?: Transaction) {
  await requireTableInOrg(deps, input.tableId, input.organizationId, transaction);
  return queryRowsWindowed(deps, input, undefined, transaction);
}

export async function setStatus(deps: CommandDependencies, input: SetStatusInput & OrgScoped & { skipAutomation?: boolean }, transaction?: Transaction) {
  return updateCell(deps, { ...input, value: input.statusOptionId }, transaction);
}

export const moveCard = setStatus;

export { countTableRows, queryRowsWindowed, recomputeAllFormulasForTable };
