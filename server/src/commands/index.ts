import { readRow } from "./relation-reads.js";
import {
  prepareRelationWrites,
  applyRelationWrites,
  createRelationColumn,
  validateRollup,
  assertNoRollupDependency,
  affectedTables,
} from "./relations.js";
import { eq, and, asc, max, sql, inArray, or } from "drizzle-orm";
import { db, type Transaction } from "../db/index.js";
import {
  tables,
  columns,
  rows,
  tableRelations,
  rowRelations,
  COLUMN_TYPES,
} from "../db/schema.js";
import {
  requireOrgId,
  requireTableInOrg,
  requireRowInOrg,
  requireColumnInOrg,
  listTablesForOrg,
} from "../tenant/scope.js";
import {
  validateCell,
  DEFAULT_PAGE_SIZE,
  changedColumns,
  type AddColumnInput,
  type AddRowInput,
  type DeleteColumnInput,
  type DeleteRowInput,
  type GetTableInput,
  type QueryRowsInput,
  type ReorderColumnsInput,
  type SetStatusInput,
  type UpdateCellInput,
  type UpdateCellsInput,
  type UpdateColumnInput,
  type CellValue,
  type ColumnDef,
} from "@tabdo/shared";
import { queryRowsWindowed, countTableRows } from "./queryRows.js";
import {
  applyFormulasToCells,
  assertFormulaConfig,
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

export async function listTables(input: OrgScoped = {}) {
  const organizationId = requireOrgId(input.organizationId);
  return listTablesForOrg(organizationId);
}

/**
 * Schema-only by default (Feishu-class): never dump 100k rows.
 * Optional includeFirstPage returns a small window in `rows`.
 */
export async function getTable({
  tableId,
  includeFirstPage,
  organizationId,
}: GetTableInput & OrgScoped) {
  const table = await requireTableInOrg(tableId, organizationId);

  const cols = await db
    .select()
    .from(columns)
    .where(eq(columns.tableId, tableId))
    .orderBy(asc(columns.sortOrder));

  const rowCount = await countTableRows(tableId);

  let rowList: (typeof rows.$inferSelect)[] = [];
  if (includeFirstPage) {
    const page = await queryRowsWindowed({
      tableId,
      limit: DEFAULT_PAGE_SIZE,
      includeTotal: false,
    });
    rowList = page.rows as typeof rowList;
  }

  return { ...table, columns: cols, rows: rowList, rowCount };
}

async function getColumnOrThrow(columnId: string, organizationId?: string) {
  if (organizationId) {
    const hit = await requireColumnInOrg(columnId, organizationId);
    return hit.column;
  }
  const [col] = await db.select().from(columns).where(eq(columns.id, columnId));
  if (!col) throw new Error(`列不存在: ${columnId}`);
  return col;
}

/** Create a product table inside an organization (scheme 2). */
export async function createTable(input: {
  organizationId: string;
  name: string;
  description?: string;
}) {
  const organizationId = requireOrgId(input.organizationId);
  const [table] = await db
    .insert(tables)
    .values({
      organizationId,
      name: input.name,
      description: input.description,
    })
    .returning();
  await db.insert(columns).values({
    tableId: table.id,
    name: "标题",
    type: "text",
    sortOrder: 0,
    width: 220,
  });
  return table;
}

export async function updateCell(input: UpdateCellInput & OrgScoped) {
  return updateCells({ ...input, cells: { [input.columnId]: input.value } });
}

export async function updateCells(input: UpdateCellsInput & OrgScoped) {
  return db.transaction((tx) => updateCellsInTransaction(tx, input));
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
    if (err) throw new Error(`校验失败 (${col.name}): ${err}`);
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
) {
  const { column } = await requireColumnInOrg(
    input.columnId,
    input.organizationId,
  );
  if (column.type !== "relation") throw new Error("字段不是关联类型");
  if (!Array.isArray(input.recordIds)) throw new Error("recordIds 必须是数组");
  return db.transaction((tx) =>
    updateCellsInTransaction(
      tx,
      { ...input, cells: { [input.columnId]: input.recordIds } },
      mode,
    ),
  );
}
export async function setRelation(
  input: import("@tabdo/shared").RelationWriteInput & OrgScoped,
) {
  return writeRelation(input, "set");
}
export async function addRelation(
  input: import("@tabdo/shared").RelationWriteInput & OrgScoped,
) {
  return writeRelation(input, "add");
}
export async function removeRelation(
  input: import("@tabdo/shared").RelationWriteInput & OrgScoped,
) {
  return writeRelation(input, "remove");
}

export async function addRow(input: AddRowInput & OrgScoped) {
  return db.transaction(async (tx) => {
    const [table] = await tx
      .select()
      .from(tables)
      .where(eq(tables.id, input.tableId));
    if (
      !table ||
      (input.organizationId && table.organizationId !== input.organizationId)
    ) {
      throw new Error(`表格不存在或不属于该工作区: ${input.tableId}`);
    }
    const cols = await loadTableColumns(input.tableId, tx);
    const colMap = columnByIdMap(cols);
    for (const [columnId, value] of Object.entries(input.cells ?? {})) {
      const col = requireColumnFromMap(colMap, columnId);
      if (col.type === "formula" || col.type === "rollup")
        throw new Error(`公式列「${col.name}」只读，由表达式自动计算`);
      const err = validateCell(col.type, value, col.config?.options);
      if (err) throw new Error(`校验失败 (${col.name}): ${err}`);
    }
    const relationIds = cols
      .filter(
        (c) => c.type === "relation" && Object.hasOwn(input.cells ?? {}, c.id),
      )
      .map((c) => c.config.relation?.relationId)
      .filter((id): id is string => Boolean(id));
    if (relationIds.length)
      await tx
        .select()
        .from(tableRelations)
        .where(inArray(tableRelations.id, relationIds))
        .orderBy(asc(tableRelations.id))
        .for("update");
    const [{ value: maxOrder }] = await tx
      .select({ value: max(rows.sortOrder) })
      .from(rows)
      .where(eq(rows.tableId, input.tableId));
    const [row] = await tx
      .insert(rows)
      .values({
        tableId: input.tableId,
        cells: applyFormulasToCells(
          cols,
          Object.fromEntries(
            Object.entries(input.cells ?? {}).filter(
              ([id]) => colMap.get(id)?.type !== "relation",
            ),
          ),
        ),
        sortOrder: (maxOrder ?? -1) + 1,
        version: 1,
      })
      .returning();
    const { plans } = await prepareRelationWrites(
      tx,
      row.id,
      cols,
      input.cells ?? {},
    );
    await applyRelationWrites(tx, plans, row.id, {
      ...input,
      organizationId: table.organizationId,
    });
    const resolved = await readRow(row.id, cols, tx, true);
    if (!input.skipAutomation)
      await appendAutomationEvent(
        tx,
        table.organizationId,
        {
          type: "row_created",
          tableId: input.tableId,
          rowId: row.id,
          cells: resolved.cells,
        },
        resolved,
        cols,
        input.actorId,
      );
    return {
      ...(await readRow(row.id, cols, tx)),
      affectedTableIds: await affectedTables(input.tableId, tx),
    };
  });
}

export async function deleteRow({
  rowId,
  organizationId,
  actorId,
}: DeleteRowInput & OrgScoped) {
  const { row, organizationId: ownerOrg } = await requireRowInOrg(
    rowId,
    organizationId,
  );
  const cols = await loadTableColumns(row.tableId);
  return db.transaction(async (tx) => {
    // Include incoming single-direction edges even when this table has no visible inverse field.
    const defs = await tx
      .select()
      .from(tableRelations)
      .where(
        or(
          eq(tableRelations.sourceTableId, row.tableId),
          eq(tableRelations.targetTableId, row.tableId),
        ),
      )
      .orderBy(asc(tableRelations.id))
      .for("update");
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
      rowId,
      deleteCols,
      values,
    );
    await applyRelationWrites(tx, plans, rowId, {
      organizationId: ownerOrg,
      actorId,
    });
    const affectedTableIds = await affectedTables(row.tableId, tx);
    const deleted = await tx.delete(rows).where(eq(rows.id, rowId)).returning();
    if (!deleted.length) throw new Error("行不存在");
    return { ok: true as const, affectedTableIds };
  });
}
export async function deleteTable(input: { tableId: string } & OrgScoped) {
  return db.transaction(async (tx) => {
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

export async function addColumn(input: AddColumnInput & OrgScoped) {
  const { tableId, name, type, config, width, organizationId } = input;
  if (!(COLUMN_TYPES as readonly string[]).includes(type)) {
    throw new Error(`不支持的列类型: ${type}`);
  }
  await requireTableInOrg(tableId, organizationId);
  if (type === "relation") return createRelationColumn(input);
  if (type === "rollup")
    return db.transaction(async (tx) => {
      const rollup = await validateRollup(tx, tableId, config?.rollup);
      const [{ position }] = await tx
        .select({
          position: sql<number>`COALESCE(max(${columns.sortOrder}),-1)+1`,
        })
        .from(columns)
        .where(eq(columns.tableId, tableId));
      const [col] = await tx
        .insert(columns)
        .values({
          tableId,
          name,
          type,
          config: { ...config, rollup },
          width: width ?? 140,
          sortOrder: position,
        })
        .returning();
      return col;
    });

  const existingCols = await loadTableColumns(tableId);
  let nextConfig = { ...(config ?? {}) };
  if (type === "formula") {
    assertFormulaConfig(nextConfig, existingCols);
    nextConfig = {
      ...nextConfig,
      formula: nextConfig.formula?.trim(),
      formulaResultType: nextConfig.formulaResultType ?? "auto",
    };
  }

  const [{ value: maxOrder }] = await db
    .select({ value: max(columns.sortOrder) })
    .from(columns)
    .where(eq(columns.tableId, tableId));

  const [col] = await db
    .insert(columns)
    .values({
      tableId,
      name,
      type,
      config: nextConfig,
      width: width ?? (type === "formula" ? 140 : 160),
      sortOrder: (maxOrder ?? -1) + 1,
    })
    .returning();

  if (type === "formula") {
    await recomputeAllFormulasForTable(tableId);
  }
  return col;
}

export async function deleteColumn({
  columnId,
  organizationId,
}: DeleteColumnInput & OrgScoped) {
  const { column } = await requireColumnInOrg(columnId, organizationId);
  const result = await db.transaction(async (tx) => {
    const defs = await tx
      .select()
      .from(tableRelations)
      .where(
        or(
          eq(tableRelations.sourceColumnId, columnId),
          eq(tableRelations.inverseColumnId, columnId),
        ),
      )
      .orderBy(asc(tableRelations.id))
      .for("update");
    const ids = [
      ...new Set([
        columnId,
        ...defs.flatMap((d) => [
          d.sourceColumnId,
          ...(d.inverseColumnId ? [d.inverseColumnId] : []),
        ]),
      ]),
    ];
    await tx
      .select()
      .from(columns)
      .where(inArray(columns.id, ids))
      .orderBy(asc(columns.id))
      .for("update");
    await assertNoRollupDependency(ids, tx);
    const affectedTableIds = [
      ...new Set([
        column.tableId,
        ...defs.flatMap((d) => [d.sourceTableId, d.targetTableId]),
      ]),
    ];
    await tx.delete(columns).where(inArray(columns.id, ids));
    return { ok: true as const, affectedTableIds };
  });
  await recomputeAllFormulasForTable(column.tableId);
  return result;
}

/**
 * Clear one cell when it fails validation for a new column type.
 * Uses version CAS; on conflict re-reads once and recomputes from latest cells.
 */
async function clearIncompatibleCellCas(args: {
  rowId: string;
  columnId: string;
  nextType: string;
  options?: { id: string }[];
  initialRow?: {
    id: string;
    cells?: Record<string, CellValue> | null;
    version?: number;
  };
}) {
  const { rowId, columnId, nextType, options } = args;
  let current = args.initialRow;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!current || attempt > 0) {
      const [fresh] = await db.select().from(rows).where(eq(rows.id, rowId));
      if (!fresh) return;
      current = fresh;
    }
    const v = current.cells?.[columnId];
    if (v === undefined || v === null || v === "") return;
    const err = validateCell(nextType, v as CellValue, options);
    if (!err) return;
    const nextCells = { ...(current.cells ?? {}), [columnId]: null };
    const casVersion = current.version ?? 0;
    const [updated] = await db
      .update(rows)
      .set({
        cells: nextCells,
        version: sql`${rows.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(rows.id, rowId), eq(rows.version, casVersion)))
      .returning();
    if (updated) return;
    // conflict — loop retries with fresh read
  }
  throw new Error(`版本冲突: 列类型转换写回行 ${rowId} 失败`);
}

export async function updateColumn(input: UpdateColumnInput & OrgScoped) {
  const col = await getColumnOrThrow(input.columnId, input.organizationId);
  const nextConfig = {
    ...(col.config ?? {}),
    ...(input.config ?? {}),
    ...(input.hidden !== undefined ? { hidden: input.hidden } : {}),
  };

  if (input.type && !(COLUMN_TYPES as readonly string[]).includes(input.type)) {
    throw new Error(`不支持的列类型: ${input.type}`);
  }

  const nextType = input.type ?? col.type;
  if (
    nextType !== col.type &&
    (nextType === "relation" ||
      nextType === "rollup" ||
      col.type === "relation" ||
      col.type === "rollup")
  )
    throw new Error("关联和汇总字段不能直接转换类型，请创建新字段");
  if (input.type && input.type !== col.type)
    await assertNoRollupDependency([col.id]);
  if (
    col.type === "relation" &&
    input.config?.relation &&
    JSON.stringify(input.config.relation) !==
      JSON.stringify(col.config.relation)
  )
    throw new Error("关联结构不能直接修改，请创建新关联字段");
  if (nextType === "formula") {
    const siblings = (await loadTableColumns(col.tableId)).filter(
      (c) => c.id !== col.id,
    );
    assertFormulaConfig(nextConfig, siblings, col.id);
    nextConfig.formula = nextConfig.formula?.trim();
    nextConfig.formulaResultType = nextConfig.formulaResultType ?? "auto";
  }

  // Type change: clear incompatible cells in batches (CAS — never overwrite concurrent cell edits)
  if (input.type && input.type !== col.type && input.type !== "formula") {
    const batchSize = 500;
    let cursor: string | null = null;
    for (;;) {
      const page = await queryRowsWindowed({
        tableId: col.tableId,
        cursor,
        limit: batchSize,
      });
      for (const r of page.rows) {
        await clearIncompatibleCellCas({
          rowId: r.id,
          columnId: input.columnId,
          nextType: input.type,
          options: nextConfig.options,
          initialRow: r,
        });
      }
      if (!page.hasMore) break;
      cursor = page.nextCursor;
    }
  }

  const updated = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(columns)
      .where(eq(columns.id, col.id))
      .for("update");
    if (!current) throw new Error("字段已删除");
    if (
      current.type !== col.type ||
      JSON.stringify(current.config) !== JSON.stringify(col.config)
    )
      throw new Error("字段配置已变化，请刷新后重试");
    if (nextType !== col.type) await assertNoRollupDependency([col.id], tx);
    if (col.type === "rollup" && input.config?.rollup)
      nextConfig.rollup = await validateRollup(
        tx,
        col.tableId,
        input.config.rollup,
      );
    const [result] = await tx
      .update(columns)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        config: nextConfig,
        ...(input.width !== undefined ? { width: input.width } : {}),
        ...(input.sortOrder !== undefined
          ? { sortOrder: input.sortOrder }
          : {}),
      })
      .where(eq(columns.id, input.columnId))
      .returning();
    return result;
  });

  const needsRecompute =
    nextType === "formula" ||
    col.type === "formula" ||
    input.name !== undefined ||
    input.config?.formula !== undefined ||
    input.config?.formulaResultType !== undefined;
  if (needsRecompute) {
    await recomputeAllFormulasForTable(col.tableId);
  }
  return updated;
}

export async function reorderColumns({
  tableId,
  columnIds,
  organizationId,
}: ReorderColumnsInput & OrgScoped) {
  await requireTableInOrg(tableId, organizationId);
  const existing = await db
    .select()
    .from(columns)
    .where(eq(columns.tableId, tableId))
    .orderBy(asc(columns.sortOrder));
  const idSet = new Set(existing.map((c) => c.id));
  for (const id of columnIds) {
    if (!idSet.has(id)) throw new Error(`列不属于该表: ${id}`);
  }
  const rest = existing
    .map((c) => c.id)
    .filter((id) => !columnIds.includes(id));
  const order = [...columnIds, ...rest];
  const updated = [];
  for (let i = 0; i < order.length; i++) {
    const [u] = await db
      .update(columns)
      .set({ sortOrder: i })
      .where(eq(columns.id, order[i]))
      .returning();
    updated.push(u);
  }
  return updated.sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Windowed query — SQL filter pushdown + keyset cursor. Never returns unbounded rows. */
export async function queryRows(input: QueryRowsInput & OrgScoped) {
  await requireTableInOrg(input.tableId, input.organizationId);
  return queryRowsWindowed(input);
}

export async function setStatus({
  rowId,
  columnId,
  statusOptionId,
  organizationId,
  actorId,
}: SetStatusInput & OrgScoped) {
  return updateCell({
    rowId,
    columnId,
    value: statusOptionId,
    organizationId,
    actorId,
  });
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
