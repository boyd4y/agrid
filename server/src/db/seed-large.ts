/**
 * Seed a large table for 100k+ smoke tests.
 * Usage: pnpm --filter server db:seed:large [count]
 * Default count: 100000
 */
import { eq } from "drizzle-orm";
import { db, client } from "./index.js";
import { seedDemoUser } from "./seed-demo.js";
import { tables, columns, rows } from "./schema.js";

const COUNT = Math.max(1, Number(process.argv[2] || 100_000));
const BATCH = 2_000;
const TABLE_NAME = "性能测试 10万行";

const STATUSES = ["todo", "doing", "done", "blocked"] as const;
const PRIORITIES = ["p0", "p1", "p2"] as const;
const TAGS = ["fe", "be", "design", "ops"] as const;
const PEOPLE = ["鲁妙子", "王语嫣", "Boyd", "Agent-A", "Agent-B"];

async function seedLarge() {
  console.log(`Seeding large table with ${COUNT.toLocaleString()} rows…`);

  let table = (
    await db.select().from(tables).where(eq(tables.name, TABLE_NAME)).limit(1)
  )[0];

  if (table) {
    const [{ value }] = await db
      .select({ value: rows.id })
      .from(rows)
      .where(eq(rows.tableId, table.id))
      .limit(1);
    // if exists, wipe rows and reseed
    console.log("Table exists, truncating rows…", table.id);
    await db.delete(rows).where(eq(rows.tableId, table.id));
  } else {
    const demo = await seedDemoUser();
    [table] = await db
      .insert(tables)
      .values({
        organizationId: demo.organizationId,
        name: TABLE_NAME,
        description: "Feishu-class virtual scroll / keyset cursor smoke table",
      })
      .returning();

    await db.insert(columns).values([
      {
        tableId: table.id,
        name: "标题",
        type: "text",
        sortOrder: 0,
        width: 260,
        config: {},
      },
      {
        tableId: table.id,
        name: "状态",
        type: "select",
        sortOrder: 1,
        width: 120,
        config: {
          options: [
            { id: "todo", label: "待办", color: "#ebeced" },
            { id: "doing", label: "进行中", color: "#d3e5ef" },
            { id: "done", label: "已完成", color: "#dbeddb" },
            { id: "blocked", label: "阻塞", color: "#ffe2dd" },
          ],
        },
      },
      {
        tableId: table.id,
        name: "优先级",
        type: "select",
        sortOrder: 2,
        width: 100,
        config: {
          options: [
            { id: "p0", label: "P0", color: "#ffe2dd" },
            { id: "p1", label: "P1", color: "#fadec9" },
            { id: "p2", label: "P2", color: "#ebeced" },
          ],
        },
      },
      {
        tableId: table.id,
        name: "负责人",
        type: "person",
        sortOrder: 3,
        width: 120,
        config: {},
      },
      {
        tableId: table.id,
        name: "标签",
        type: "multi_select",
        sortOrder: 4,
        width: 160,
        config: {
          options: [
            { id: "fe", label: "前端", color: "#e8deee" },
            { id: "be", label: "后端", color: "#d3e5ef" },
            { id: "design", label: "设计", color: "#f5e0e9" },
            { id: "ops", label: "运维", color: "#dbeddb" },
          ],
        },
      },
      {
        tableId: table.id,
        name: "预估工时",
        type: "number",
        sortOrder: 5,
        width: 100,
        config: {},
      },
      {
        tableId: table.id,
        name: "截止日期",
        type: "date",
        sortOrder: 6,
        width: 130,
        config: {},
      },
      {
        tableId: table.id,
        name: "已完成",
        type: "checkbox",
        sortOrder: 7,
        width: 80,
        config: {},
      },
    ]);
  }

  const cols = await db.select().from(columns).where(eq(columns.tableId, table.id));
  const byName = Object.fromEntries(cols.map((c) => [c.name, c.id]));

  const t0 = Date.now();
  let inserted = 0;
  while (inserted < COUNT) {
    const n = Math.min(BATCH, COUNT - inserted);
    const batch = [];
    for (let i = 0; i < n; i++) {
      const idx = inserted + i;
      const status = STATUSES[idx % STATUSES.length];
      const priority = PRIORITIES[idx % PRIORITIES.length];
      const person = PEOPLE[idx % PEOPLE.length];
      const tags = [TAGS[idx % TAGS.length], TAGS[(idx + 1) % TAGS.length]];
      const day = String((idx % 28) + 1).padStart(2, "0");
      batch.push({
        tableId: table.id,
        sortOrder: idx,
        version: 1,
        cells: {
          [byName["标题"]]: `任务 #${idx + 1}`,
          [byName["状态"]]: status,
          [byName["优先级"]]: priority,
          [byName["负责人"]]: person,
          [byName["标签"]]: tags,
          [byName["预估工时"]]: (idx % 40) + 1,
          [byName["截止日期"]]: `2026-10-${day}`,
          [byName["已完成"]]: status === "done",
        },
      });
    }
    await db.insert(rows).values(batch);
    inserted += n;
    if (inserted % 10_000 === 0 || inserted === COUNT) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  ${inserted.toLocaleString()} / ${COUNT.toLocaleString()} (${elapsed}s)`);
    }
  }

  console.log("Done. tableId=", table.id, "rows=", COUNT);
  await client.end();
}

seedLarge().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
