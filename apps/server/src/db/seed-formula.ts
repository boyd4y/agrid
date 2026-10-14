import { withNodeResources } from "../resources/node.js";
/**
 * Idempotent: add a demo formula column to the first table if missing.
 */
import { eq } from "drizzle-orm";
import { db, client } from "./index.js";
import { tables, columns } from "./schema.js";
import { addColumn } from "../commands/index.js";

async function main() {
  const [table] = await db.select().from(tables).limit(1);
  if (!table) {
    console.log("No table; run db:seed first");
    await client.end();
    return;
  }
  const cols = await db.select().from(columns).where(eq(columns.tableId, table.id));
  const has = cols.some((c) => c.type === "formula" || c.name === "工时×8");
  if (has) {
    console.log("Formula column already present on", table.name);
    await client.end();
    return;
  }
  const hours = cols.find((c) => c.name === "预估工时");
  if (!hours) {
    console.log("No 预估工时 column; skip");
    await client.end();
    return;
  }
  const col = await addColumn({
    tableId: table.id,
    name: "工时×8",
    type: "formula",
    config: { formula: "{预估工时} * 8", formulaResultType: "number" },
    width: 110,
  });
  console.log("Added formula column", col.id, "on", table.name);
  await client.end();
}

withNodeResources(main).catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
