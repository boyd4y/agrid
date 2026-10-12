import { eq, and, asc, max, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { tables, columns, rows, COLUMN_TYPES } from "../db/schema.js";
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
} from "@table/shared";
import { queryRowsWindowed, countTableRows } from "./queryRows.js";
import {
  applyFormulasToCells,
  assertFormulaConfig,
  loadTableColumns,
  recomputeAllFormulasForTable,
} from "./formulas.js";
import { scheduleAutomationEvent } from "../automation/engine.js";
import * as automationCrud from "../automation/crud.js";

export type OrgScoped = { organizationId?: string };

/** Own-property column lookup — never resolve prototype keys (constructor, toString, __proto__). */
function columnByIdMap<T extends { id: string; type: string }>(cols: T[]): Map<string, T> {
  return new Map(cols.map((c) => [c.id, c]));
}

function requireColumnFromMap<T extends { id: string; type: string; name?: string }>(
  colMap: Map<string, T>,
  columnId: string
): T {
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

export async function updateCell({
  rowId,
  columnId,
  value,
  expectedVersion,
  skipAutomation,
  organizationId,
}: UpdateCellInput & OrgScoped) {
  let existing;
  if (organizationId) {
    existing = (await requireRowInOrg(rowId, organizationId)).row;
  } else {
    const [r] = await db.select().from(rows).where(eq(rows.id, rowId));
    if (!r) throw new Error(`行不存在: ${rowId}`);
    existing = r;
  }
  const casVersion = expectedVersion ?? existing.version;
  if (
    expectedVersion !== undefined &&
    existing.version !== undefined &&
    existing.version !== expectedVersion
  ) {
    throw new Error(`版本冲突: expected ${expectedVersion}, got ${existing.version}`);
  }

  const cols = await loadTableColumns(existing.tableId);
  const col = cols.find((c) => c.id === columnId);
  if (!col) throw new Error(`列不属于该表: ${columnId}`);
  if (col.type === "formula") {
    throw new Error(`公式列「${col.name}」只读，由表达式自动计算`);
  }
  const err = validateCell(col.type, value, col.config?.options);
  if (err) throw new Error(`校验失败 (${col.name}): ${err}`);

  const before = { ...(existing.cells ?? {}) } as Record<string, CellValue>;
  const nextCells = applyFormulasToCells(cols, {
    ...before,
    [columnId]: value as CellValue,
  });
  const [updated] = await db
    .update(rows)
    .set({
      cells: nextCells,
      version: sql`${rows.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(rows.id, rowId), eq(rows.version, casVersion)))
    .returning();
  if (!updated) {
    throw new Error(`版本冲突: expected ${casVersion}`);
  }

  if (!skipAutomation) {
    const after = (updated.cells ?? {}) as Record<string, CellValue>;
    scheduleAutomationEvent({
      type: "cells_changed",
      tableId: existing.tableId,
      rowId,
      before,
      after,
      changedColumnIds: changedColumns(before, after),
    });
  }
  return updated;
}

export async function updateCells({
  rowId,
  cells,
  expectedVersion,
  skipAutomation,
  organizationId,
}: UpdateCellsInput & OrgScoped) {
  let existing;
  if (organizationId) {
    existing = (await requireRowInOrg(rowId, organizationId)).row;
  } else {
    const [r] = await db.select().from(rows).where(eq(rows.id, rowId));
    if (!r) throw new Error(`行不存在: ${rowId}`);
    existing = r;
  }
  const casVersion = expectedVersion ?? existing.version;
  if (
    expectedVersion !== undefined &&
    existing.version !== undefined &&
    existing.version !== expectedVersion
  ) {
    throw new Error(`版本冲突: expected ${expectedVersion}, got ${existing.version}`);
  }

  const cols = await loadTableColumns(existing.tableId);
  const colMap = columnByIdMap(cols);
  for (const [columnId, value] of Object.entries(cells)) {
    const col = requireColumnFromMap(colMap, columnId);
    if (col.type === "formula") {
      throw new Error(`公式列「${col.name}」只读，由表达式自动计算`);
    }
    const err = validateCell(col.type, value, col.config?.options);
    if (err) throw new Error(`校验失败 (${col.name}): ${err}`);
  }

  const before = { ...(existing.cells ?? {}) } as Record<string, CellValue>;
  const nextCells = applyFormulasToCells(cols, { ...before, ...cells });
  const [updated] = await db
    .update(rows)
    .set({
      cells: nextCells,
      version: sql`${rows.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(rows.id, rowId), eq(rows.version, casVersion)))
    .returning();
  if (!updated) {
    throw new Error(`版本冲突: expected ${casVersion}`);
  }

  if (!skipAutomation) {
    const after = (updated.cells ?? {}) as Record<string, CellValue>;
    scheduleAutomationEvent({
      type: "cells_changed",
      tableId: existing.tableId,
      rowId,
      before,
      after,
      changedColumnIds: changedColumns(before, after),
    });
  }
  return updated;
}

export async function addRow({
  tableId,
  cells,
  skipAutomation,
  organizationId,
}: AddRowInput & OrgScoped) {
  await requireTableInOrg(tableId, organizationId);

  const cols = await loadTableColumns(tableId);
  const colMap = columnByIdMap(cols);
  if (cells) {
    for (const [columnId, value] of Object.entries(cells)) {
      const col = requireColumnFromMap(colMap, columnId);
      if (col.type === "formula") {
        throw new Error(`公式列「${col.name}」只读，由表达式自动计算`);
      }
      const err = validateCell(col.type, value, col.config?.options);
      if (err) throw new Error(`校验失败 (${col.name}): ${err}`);
    }
  }

  const [{ value: maxOrder }] = await db
    .select({ value: max(rows.sortOrder) })
    .from(rows)
    .where(eq(rows.tableId, tableId));

  const seeded = applyFormulasToCells(cols, cells ?? {});
  const [row] = await db
    .insert(rows)
    .values({
      tableId,
      cells: seeded,
      sortOrder: (maxOrder ?? -1) + 1,
      version: 1,
    })
    .returning();

  if (!skipAutomation) {
    scheduleAutomationEvent({
      type: "row_created",
      tableId,
      rowId: row.id,
      cells: (row.cells ?? {}) as Record<string, CellValue>,
    });
  }
  return row;
}

export async function deleteRow({ rowId, organizationId }: DeleteRowInput & OrgScoped) {
  if (organizationId) {
    await requireRowInOrg(rowId, organizationId);
  }
  const deleted = await db.delete(rows).where(eq(rows.id, rowId)).returning();
  if (!deleted.length) throw new Error(`行不存在: ${rowId}`);
  return { ok: true as const };
}

export async function addColumn(input: AddColumnInput & OrgScoped) {
  const { tableId, name, type, config, width, organizationId } = input;
  if (!(COLUMN_TYPES as readonly string[]).includes(type)) {
    throw new Error(`不支持的列类型: ${type}`);
  }
  await requireTableInOrg(tableId, organizationId);

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

export async function deleteColumn({ columnId, organizationId }: DeleteColumnInput & OrgScoped) {
  if (organizationId) {
    await requireColumnInOrg(columnId, organizationId);
  }
  const deleted = await db.delete(columns).where(eq(columns.id, columnId)).returning();
  if (!deleted.length) throw new Error(`列不存在: ${columnId}`);
  // Dependents that referenced this column by name will error until formula is fixed
  const tableId = deleted[0].tableId;
  await recomputeAllFormulasForTable(tableId);
  return { ok: true as const };
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
  if (nextType === "formula") {
    const siblings = (await loadTableColumns(col.tableId)).filter((c) => c.id !== col.id);
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

  const [updated] = await db
    .update(columns)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      config: nextConfig,
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    })
    .where(eq(columns.id, input.columnId))
    .returning();

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
  const rest = existing.map((c) => c.id).filter((id) => !columnIds.includes(id));
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
}: SetStatusInput & OrgScoped) {
  return updateCell({ rowId, columnId, value: statusOptionId, organizationId });
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

export const commands = {
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
