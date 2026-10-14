import { withNodeResources } from "../resources/node.js";
/**
 * Smoke: keyset pagination + filter pushdown against large table.
 * Usage: pnpm --filter @tabdo/server db:smoke:perf [tableId]
 */
import { eq } from "drizzle-orm";
import { db, client } from "./index.js";
import { tables, columns } from "./schema.js";
import { queryRowsWindowed } from "../commands/queryRows.js";
import { getTable, updateCell } from "../commands/index.js";

async function main() {
  const argId = process.argv[2];
  let tableId = argId;
  if (!tableId) {
    const [t] =
      (await db
        .select()
        .from(tables)
        .where(eq(tables.name, "性能测试 10万行"))
        .limit(1)) || [];
    if (!t) {
      const all = await db.select().from(tables).limit(1);
      tableId = all[0]?.id;
    } else {
      tableId = t.id;
    }
  }
  if (!tableId) {
    console.error("No table found. Run db:seed:large first.");
    process.exit(1);
  }

  console.log("Smoke table:", tableId);

  const tMeta0 = Date.now();
  const meta = await getTable({ tableId, includeFirstPage: false });
  console.log(
    `getTable (schema only): ${Date.now() - tMeta0}ms · columns=${meta.columns.length} · rowCount=${meta.rowCount}`
  );
  if (meta.rows.length > 0) {
    console.error("FAIL: getTable returned rows (must be empty)");
    process.exit(1);
  }

  const statusCol = meta.columns.find((c) => c.name === "状态");
  const titleCol = meta.columns.find((c) => c.name === "标题");

  // Page through first 5 windows
  let cursor: string | null = null;
  let totalFetched = 0;
  const tPage0 = Date.now();
  for (let i = 0; i < 5; i++) {
    const page = await queryRowsWindowed({
      tableId,
      cursor,
      limit: 100,
      includeTotal: i === 0,
    });
    totalFetched += page.rows.length;
    console.log(
      `  page ${i}: rows=${page.rows.length} hasMore=${page.hasMore} totalMatched=${page.totalMatched ?? "-"} cursor=${page.nextCursor ? "yes" : "no"}`
    );
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }
  console.log(`5 windows: ${Date.now() - tPage0}ms · fetched=${totalFetched}`);

  // Filter pushdown
  if (statusCol) {
    const tF = Date.now();
    const filtered = await queryRowsWindowed({
      tableId,
      limit: 50,
      includeTotal: true,
      filters: [
        {
          id: "f1",
          columnId: statusCol.id,
          op: "eq",
          value: "doing",
        },
      ],
      filterLogic: "and",
    });
    console.log(
      `filter status=doing: ${Date.now() - tF}ms · matched=${filtered.totalMatched} · page=${filtered.rows.length}`
    );
  }

  // Kanban column window
  if (statusCol) {
    const tK = Date.now();
    const kanban = await queryRowsWindowed({
      tableId,
      limit: 40,
      includeTotal: true,
      statusColumnId: statusCol.id,
      statusValue: "todo",
    });
    console.log(
      `kanban todo window: ${Date.now() - tK}ms · total=${kanban.totalMatched} · page=${kanban.rows.length}`
    );
  }

  // Single-cell patch
  const first = await queryRowsWindowed({ tableId, limit: 1 });
  if (first.rows[0] && titleCol) {
    const row = first.rows[0];
    const tP = Date.now();
    const updated = await updateCell({
      rowId: row.id,
      columnId: titleCol.id,
      value: String(row.cells[titleCol.id] ?? "") + " ✓",
      expectedVersion: row.version,
    });
    console.log(
      `single-cell patch: ${Date.now() - tP}ms · version ${row.version} → ${updated.version}`
    );
  }

  console.log("SMOKE OK");
  await client.end();
}

withNodeResources(main).catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
