import { eq, sql } from "drizzle-orm";
import {
  recomputeRowFormulas,
  validateFormula,
  type CellValue,
  type ColumnDef,
} from "@table/shared";
import { db } from "../db/index.js";
import { columns, rows } from "../db/schema.js";
import { queryRowsWindowed } from "./queryRows.js";

export async function loadTableColumns(tableId: string): Promise<ColumnDef[]> {
  const cols = await db
    .select()
    .from(columns)
    .where(eq(columns.tableId, tableId));
  return cols as ColumnDef[];
}

/** Apply formula recompute to an in-memory cells map. */
export function applyFormulasToCells(
  cols: ColumnDef[],
  cells: Record<string, CellValue>
): Record<string, CellValue> {
  return recomputeRowFormulas(cols, cells);
}

/**
 * Persist recomputed formula cells for one row.
 * Caller may already have written non-formula cells; we merge & bump version once more
 * only if formula values changed — or fold into the same write when possible.
 */
export async function persistRowWithFormulas(
  rowId: string,
  tableId: string,
  cells: Record<string, CellValue>,
  cols?: ColumnDef[]
) {
  const columnDefs = cols ?? (await loadTableColumns(tableId));
  const nextCells = recomputeRowFormulas(columnDefs, cells);
  const [updated] = await db
    .update(rows)
    .set({
      cells: nextCells,
      version: sql`${rows.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(rows.id, rowId))
    .returning();
  return updated;
}

/** Recompute formulas for every row in a table (batched for 10w+). */
export async function recomputeAllFormulasForTable(tableId: string) {
  const cols = await loadTableColumns(tableId);
  if (!cols.some((c) => c.type === "formula")) return { updated: 0 };

  const batchSize = 200;
  let cursor: string | null = null;
  let updated = 0;
  for (;;) {
    const page = await queryRowsWindowed({
      tableId,
      cursor,
      limit: batchSize,
    });
    for (const r of page.rows) {
      const nextCells = recomputeRowFormulas(cols, (r.cells ?? {}) as Record<string, CellValue>);
      // cheap equality check
      const prev = JSON.stringify(r.cells ?? {});
      const next = JSON.stringify(nextCells);
      if (prev === next) continue;
      await db
        .update(rows)
        .set({
          cells: nextCells,
          version: sql`${rows.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(rows.id, r.id));
      updated++;
    }
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }
  return { updated };
}

export function assertFormulaConfig(
  config: { formula?: string; formulaResultType?: string } | undefined,
  allColumns: ColumnDef[],
  selfColumnId?: string
) {
  const formula = config?.formula?.trim() ?? "";
  if (!formula) throw new Error("公式列必须填写表达式（config.formula）");
  const err = validateFormula(formula, allColumns, selfColumnId);
  if (err) throw new Error(err);
}
