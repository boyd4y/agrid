import "../load-env.js";
import { db, client } from "./index.js";
import { tables, columns, rows } from "./schema.js";
import { ensureDemoFormView } from "../commands/views.js";
import {
  seedDemoUser,
  DEMO_EMAIL,
  DEMO_PASSWORD,
} from "./seed-demo.js";

async function seed() {
  // Always ensure fixed demo login (idempotent)
  const demo = await seedDemoUser();
  console.log(
    demo.created
      ? "Demo user created."
      : "Demo user already present (password refreshed)."
  );
  console.log("Demo login:");
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);

  const existing = await db.select().from(tables).limit(1);
  if (existing.length > 0) {
    console.log("Already seeded tables, skip. Table id:", existing[0].id);
    try {
      const form = await ensureDemoFormView(existing[0].id, demo.organizationId);
      console.log("Demo form view:", form?.id, form?.name);
    } catch (e) {
      console.warn("ensureDemoFormView:", e instanceof Error ? e.message : e);
    }
    await client.end();
    return;
  }

  const [table] = await db
    .insert(tables)
    .values({
      name: "产品需求看板",
      description: "Notion / 飞书风格多维表格 Demo",
      organizationId: demo.organizationId,
    })
    .returning();

  const colDefs = [
    {
      name: "标题",
      type: "text",
      sortOrder: 0,
      width: 220,
      config: {},
    },
    {
      name: "状态",
      type: "select",
      sortOrder: 1,
      width: 140,
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
      name: "优先级",
      type: "select",
      sortOrder: 2,
      width: 120,
      config: {
        options: [
          { id: "p0", label: "P0", color: "#ffe2dd" },
          { id: "p1", label: "P1", color: "#fadec9" },
          { id: "p2", label: "P2", color: "#ebeced" },
        ],
      },
    },
    {
      name: "负责人",
      type: "person",
      sortOrder: 3,
      width: 120,
      config: {},
    },
    {
      name: "标签",
      type: "multi_select",
      sortOrder: 4,
      width: 180,
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
      name: "预估工时",
      type: "number",
      sortOrder: 5,
      width: 110,
      config: {},
    },
    {
      name: "截止日期",
      type: "date",
      sortOrder: 6,
      width: 140,
      config: {},
    },
    {
      name: "已完成",
      type: "checkbox",
      sortOrder: 7,
      width: 90,
      config: {},
    },
    {
      name: "工时×8",
      type: "formula",
      sortOrder: 8,
      width: 110,
      config: {
        formula: "{预估工时} * 8",
        formulaResultType: "number" as const,
      },
    },
  ];

  const insertedCols = await db
    .insert(columns)
    .values(colDefs.map((c) => ({ ...c, tableId: table.id })))
    .returning();

  const byName = Object.fromEntries(insertedCols.map((c) => [c.name, c.id]));

  const demoRows = [
    {
      title: "多维表格单元格内编辑",
      status: "done",
      priority: "p0",
      person: "鲁妙子",
      tags: ["fe", "be"],
      hours: 8,
      date: "2026-10-08",
      done: true,
    },
    {
      title: "列类型：单选 / 多选 / 日期",
      status: "doing",
      priority: "p0",
      person: "王语嫣",
      tags: ["fe"],
      hours: 5,
      date: "2026-10-12",
      done: false,
    },
    {
      title: "PostgreSQL + Drizzle 持久化",
      status: "done",
      priority: "p1",
      person: "Boyd",
      tags: ["be"],
      hours: 6,
      date: "2026-10-10",
      done: true,
    },
    {
      title: "乐观更新与错误回滚",
      status: "todo",
      priority: "p1",
      person: "鲁妙子",
      tags: ["fe"],
      hours: 4,
      date: "2026-10-15",
      done: false,
    },
    {
      title: "导出 CSV / 公式列（二期）",
      status: "blocked",
      priority: "p2",
      person: "",
      tags: ["fe", "be"],
      hours: 12,
      date: "2026-11-01",
      done: false,
    },
  ];

  await db.insert(rows).values(
    demoRows.map((r, i) => ({
      tableId: table.id,
      sortOrder: i,
      cells: {
        [byName["标题"]]: r.title,
        [byName["状态"]]: r.status,
        [byName["优先级"]]: r.priority,
        [byName["负责人"]]: r.person,
        [byName["标签"]]: r.tags,
        [byName["预估工时"]]: r.hours,
        [byName["截止日期"]]: r.date,
        [byName["已完成"]]: r.done,
      },
    }))
  );

  console.log("Seeded table:", table.id, table.name);
  console.log("Columns:", insertedCols.length, "Rows:", demoRows.length);
  const form = await ensureDemoFormView(table.id, demo.organizationId);
  console.log("Demo form view:", form?.id, form?.name);
  await client.end();
}

seed().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
