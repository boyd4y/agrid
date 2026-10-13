import { and, asc, eq, gt, sql } from "drizzle-orm";
import {
  recomputeRowFormulas,
  resolveFormulaDepIds,
  validateFormula,
  type CellValue,
  type ColumnDef,
} from "@tabdo/shared";
import { db, type Database, type Transaction } from "../db/index.js";
import { columns, rows } from "../db/schema.js";
import { queryRowsWindowed } from "./queryRows.js";

export async function loadTableColumns(
  tableId: string,
  executor: Database = db,
): Promise<ColumnDef[]> {
  const cols = await executor
    .select()
    .from(columns)
    .where(eq(columns.tableId, tableId));
  return cols as ColumnDef[];
}

/** Apply formula recompute to an in-memory cells map. */
export function applyFormulasToCells(
  cols: ColumnDef[],
  cells: Record<string, CellValue>,
): Record<string, CellValue> {
  return recomputeRowFormulas(cols, physicalCells(cols, cells));
}

function physicalCells(cols: ColumnDef[], cells: Record<string, CellValue>) {
  const virtual = new Set(
    cols
      .filter((c) => c.type === "relation" || c.type === "rollup")
      .map((c) => c.id),
  );
  return Object.fromEntries(
    Object.entries(cells).filter(([id]) => !virtual.has(id)),
  );
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
  cols?: ColumnDef[],
) {
  const columnDefs = cols ?? (await loadTableColumns(tableId));
  for (let attempt = 0; attempt < 2; attempt++) {
    const [existing] = await db.select().from(rows).where(eq(rows.id, rowId));
    if (!existing) return undefined;
    // Prefer caller cells on first attempt; on CAS miss recompute from latest row cells
    const base =
      attempt === 0
        ? cells
        : ((existing.cells ?? {}) as Record<string, CellValue>);
    const nextCells = applyFormulasToCells(columnDefs, base);
    const [updated] = await db
      .update(rows)
      .set({
        cells: nextCells,
        version: sql`${rows.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(rows.id, rowId), eq(rows.version, existing.version)))
      .returning();
    if (updated) return updated;
  }
  // Skip after one retry — caller (batch) can continue
  return undefined;
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
      let current = r;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) {
          const [fresh] = await db.select().from(rows).where(eq(rows.id, r.id));
          if (!fresh) break;
          current = fresh;
        }
        const nextCells = applyFormulasToCells(
          cols,
          (current.cells ?? {}) as Record<string, CellValue>,
        );
        const prev = JSON.stringify(
          physicalCells(
            cols,
            (current.cells ?? {}) as Record<string, CellValue>,
          ),
        );
        const next = JSON.stringify(nextCells);
        if (prev === next) break;
        const [u] = await db
          .update(rows)
          .set({
            cells: nextCells,
            version: sql`${rows.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(rows.id, current.id),
              eq(rows.version, current.version ?? 0),
            ),
          )
          .returning();
        if (u) {
          updated++;
          break;
        }
        // CAS miss — retry once from latest; then skip
      }
    }
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }
  return { updated };
}

export function assertFormulaConfig(
  config: { formula?: string; formulaResultType?: string } | undefined,
  allColumns: ColumnDef[],
  selfColumnId?: string,
) {
  const formula = config?.formula?.trim() ?? "";
  if (!formula) throw new Error("公式列必须填写表达式（config.formula）");
  const deps = resolveFormulaDepIds(formula, allColumns).ids;
  if (
    allColumns.some(
      (c) =>
        deps.includes(c.id) && (c.type === "relation" || c.type === "rollup"),
    )
  )
    throw new Error(
      "第一版公式暂不支持引用关联或汇总字段，请使用汇总字段计算跨表数据",
    );
  const err = validateFormula(formula, allColumns, selfColumnId);
  if (err) throw new Error(err);
}

/** Recompute in the caller transaction so schema batches also roll back computed cells. */
export async function recomputeFormulasInTransaction(tableId: string, tx: Transaction) {
  const cols = await loadTableColumns(tableId, tx);
  if (!cols.some((c) => c.type === "formula")) return { updated: 0 };
  let cursor: string | undefined, updated = 0;
  for (;;) {
    const page = await tx.select().from(rows)
      .where(and(eq(rows.tableId, tableId), cursor ? gt(rows.id, cursor) : undefined))
      .orderBy(asc(rows.id)).limit(200).for("update");
    if (!page.length) break;
    for (const row of page) {
      const cells = (row.cells ?? {}) as Record<string, CellValue>;
      const next = applyFormulasToCells(cols, cells);
      if (JSON.stringify(physicalCells(cols, cells)) !== JSON.stringify(next)) {
        await tx.update(rows).set({ cells: next, version: sql`${rows.version}+1`, updatedAt: new Date() }).where(eq(rows.id, row.id));
        updated++;
      }
    }
    cursor = page.at(-1)!.id;
  }
  return { updated };
}
