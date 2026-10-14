import { withNodeResources } from "../resources/node.js";
import { listTables, getTable, queryRows, updateCell } from "../commands/index.js";
import { client } from "./index.js";

async function main() {
  const { db } = await import("./index.js");
  const { tables: tablesTbl } = await import("./schema.js");
  const [{ organizationId }] = await db.select({ organizationId: tablesTbl.organizationId }).from(tablesTbl).limit(1);
  const tables = await listTables({ organizationId });
  const t = tables[0];
  if (!t) throw new Error("no table");
  const full = await getTable({ tableId: t.id });
  const fx = full.columns.find((c) => c.type === "formula");
  const hoursCol = full.columns.find((c) => c.name === "预估工时");
  if (!fx || !hoursCol) throw new Error("missing formula or hours col");
  console.log("formula:", fx.name, fx.config?.formula);

  const page = await queryRows({ tableId: t.id, limit: 1 });
  const row = page.rows[0];
  if (!row) throw new Error("no rows");

  const updated = await updateCell({
    rowId: row.id,
    columnId: hoursCol.id,
    value: 7,
    skipAutomation: true,
  });
  const got = updated.cells[fx.id];
  console.log("hours=7 → fx=", got, got === 56 ? "OK" : "FAIL");
  if (got !== 56) process.exitCode = 1;

  // reject write to formula
  try {
    await updateCell({
      rowId: row.id,
      columnId: fx.id,
      value: 1,
      skipAutomation: true,
    });
    console.log("FAIL: formula write should reject");
    process.exitCode = 1;
  } catch (e) {
    console.log("formula write rejected OK:", (e as Error).message.slice(0, 40));
  }

  await client.end();
}

withNodeResources(main).catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
