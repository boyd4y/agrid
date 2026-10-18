import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { and, eq, isNull } from "drizzle-orm";
import type { CellValue, ColumnType } from "@tabdo/shared";
import { db, client } from "./index.js";
import { tables, columns, rows, automations, agentProfile, user, member, tableViews } from "./schema.js";
import { seedDemoUser, DEMO_EMAIL } from "./seed-demo.js";
import { withNodeResources } from "../resources/node.js";
import { createTable, addColumn, addRow, createAutomation, createBoardView, createGridView, getWorkspace } from "../commands/index.js";
import { createRelationColumn } from "../commands/relations.js";
import { SCENARIO_A_AGENT, SCENARIO_A_PROMPT, scenarioAActions } from "./scenario-a-config.js";

type Field = { name: string; type: ColumnType; config?: { options: { id: string; label: string; color: string }[] } };
const statuses = (labels: string[], ids: string[]) => ({ options: labels.map((label, i) => ({ id: ids[i], label, color: ["#ebeced", "#d3e5ef", "#fadec9", "#e8deee", "#dbeddb", "#ffe2dd"][i] })) });
const customerFields: Field[] = [
  { name: "客户姓名", type: "text" }, { name: "手机", type: "text" }, { name: "邮箱", type: "text" },
  { name: "状态", type: "select", config: statuses(["新线索", "跟进中", "已约看", "已带看", "成交", "流失"], ["lead", "follow", "scheduled", "shown", "won", "lost"]) },
  { name: "下次跟进", type: "date" }, { name: "预算", type: "number" }, { name: "意向区域", type: "text" }, { name: "备注", type: "text" }, { name: "跟进邮件草稿", type: "text" },
];
const listingFields: Field[] = [
  { name: "标题/小区", type: "text" }, { name: "状态", type: "select", config: statuses(["在售", "已定", "下架"], ["available", "reserved", "off_market"]) },
  { name: "价格", type: "number" }, { name: "面积", type: "number" }, { name: "地址", type: "text" }, { name: "下次跟进", type: "date" }, { name: "备注", type: "text" },
];

async function ensureTable(organizationId: string, name: string, fields: Field[], icon: string) {
  const { workspace } = await getWorkspace({ organizationId });
  let [table] = await db.select().from(tables).where(and(eq(tables.organizationId, organizationId), eq(tables.workspaceId, workspace.id), eq(tables.name, name)));
  if (!table) {
    table = await createTable({ organizationId, name, description: "Scenario A 房产经纪人演示：所有客户、房源和地址均为虚构样例，价格/预算单位为万元。" });
    const [title] = await db.select().from(columns).where(eq(columns.tableId, table.id));
    await db.update(columns).set({ name: fields[0].name }).where(eq(columns.id, title.id));
    await db.update(tables).set({ icon, pinned: true }).where(eq(tables.id, table.id));
  }
  let cols = await db.select().from(columns).where(eq(columns.tableId, table.id));
  for (const field of fields) {
    const existing = cols.find(c => c.name === field.name);
    if (existing && existing.type !== field.type) throw new Error(`${name}.${field.name} 类型不匹配；请人工检查，seed 不覆盖已有数据`);
    if (!existing) await addColumn({ organizationId, tableId: table.id, ...field });
  }
  cols = await db.select().from(columns).where(eq(columns.tableId, table.id));
  const byName = Object.fromEntries(cols.map(c => [c.name, c.id]));
  const views = await db.select().from(tableViews).where(eq(tableViews.tableId, table.id));
  if (!views.some(v => v.type === "grid")) await createGridView({ organizationId, tableId: table.id, name: "表格" });
  if (!views.some(v => v.type === "board")) await createBoardView({ organizationId, tableId: table.id, name: "看板", config: { statusColumnId: byName["状态"], hideEmpty: false, density: "comfortable" } });
  return { id: table.id, byName };
}

async function ensureAgent(organizationId: string) {
  const [existing] = await db.select().from(agentProfile).where(and(eq(agentProfile.organizationId, organizationId), eq(agentProfile.displayName, SCENARIO_A_AGENT)));
  if (existing) return existing.userId;
  const userId = randomUUID(), memberId = randomUUID();
  await db.transaction(async tx => {
    await tx.insert(user).values({ id: userId, name: SCENARIO_A_AGENT, email: `agent+${userId}@agents.local`, emailVerified: true, kind: "agent" });
    await tx.insert(member).values({ id: memberId, organizationId, userId, role: "member" });
    await tx.insert(agentProfile).values({ userId, memberId, organizationId, displayName: SCENARIO_A_AGENT, persona: { systemPrompt: SCENARIO_A_PROMPT, skillNames: ["table", "automation"], disabledTools: ["send_email", "reply_email"], defaultHarness: "pi", defaultModel: "__harness_default__", runtime: "local" } });
  });
  return userId;
}

/** Sequential reruns preserve edits; names identify fixtures. Run inside withNodeResources. */
export async function seedScenarioA(organizationId?: string) {
  if (!organizationId) organizationId = (await seedDemoUser()).organizationId;
  const [demo] = await db.select().from(user).where(eq(user.email, DEMO_EMAIL));
  if (!demo) throw new Error("Run seedDemoUser first");
  const scope = { organizationId, actorId: demo.id };
  const { workspace } = await getWorkspace(scope);
  const listings = await ensureTable(organizationId, "房源", listingFields, "House");
  const customers = await ensureTable(organizationId, "意向客户", customerFields, "Contact");
  if (!customers.byName["意向房源"]) {
    const relation = await createRelationColumn({ ...scope, tableId: customers.id, name: "意向房源", config: { relation: { targetTableId: listings.id, limit: "many", inverseName: "意向客户", inverseLimit: "many" } } });
    customers.byName["意向房源"] = relation.id;
  } else {
    const [col] = await db.select().from(columns).where(eq(columns.id, customers.byName["意向房源"]));
    if (col.type !== "relation" || col.config?.relation?.targetTableId !== listings.id) throw new Error("意向房源关联配置不匹配，请人工检查");
  }
  async function fixture(table: typeof listings, values: Record<string, CellValue>) {
    const title = Object.keys(values)[0];
    const existing = await db.select().from(rows).where(eq(rows.tableId, table.id));
    const found = existing.find(r => r.cells[table.byName[title]] === values[title]);
    if (found) return found.id;
    const row = await addRow({ ...scope, tableId: table.id, skipAutomation: true, cells: Object.fromEntries(Object.entries(values).map(([key, value]) => [table.byName[key], value])) });
    return row.id;
  }
  const listingIds: string[] = [];
  for (const [i, title] of ["演示·梧桐雅苑两居", "演示·江畔新城三居", "演示·青禾里一居"].entries()) {
    listingIds.push(await fixture(listings, { "标题/小区": title, "状态": i === 2 ? "reserved" : "available", "价格": [420, 680, 280][i], "面积": [85, 128, 52][i], "地址": `上海市演示路${i + 1}号（虚构地址）`, "备注": "虚构演示房源，不构成真实房产信息" }));
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const yesterday = new Date(`${today}T00:00:00+08:00`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const overdue = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(yesterday);
  for (const [i, name] of ["演示·陈女士", "演示·李先生", "演示·周女士", "演示·赵先生", "演示·吴女士"].entries()) {
    await fixture(customers, { "客户姓名": name, "手机": "", "邮箱": `scenario-a-${i + 1}@example.com`, "状态": ["lead", "follow", "scheduled", "shown", "won"][i], "下次跟进": i === 1 ? overdue : today, "预算": [450, 700, 320, 480, 680][i], "意向区域": ["徐汇", "浦东", "长宁", "徐汇", "浦东"][i], "备注": "虚构演示客户；邮箱仅为样例，不可用于真实发送；预约时间待确认", "跟进邮件草稿": "", "意向房源": [listingIds[i % listingIds.length]] });
  }
  const agentUserId = await ensureAgent(organizationId);
  const actions = scenarioAActions(agentUserId);
  const definitions = [
    { name: "状态进入已约看 → 提醒", source: { kind: "table" as const, tableId: customers.id }, trigger: { type: "enter_status" as const, columnId: customers.byName["状态"], optionId: "scheduled" } },
    { name: "每日跟进检查（定时）", source: { kind: "schedule" as const, cron: "0 9 * * *", timeZone: "Asia/Shanghai" }, trigger: { type: "schedule_due" as const } },
    { name: "带看后起草跟进邮件", source: { kind: "table" as const, tableId: customers.id }, trigger: { type: "enter_status" as const, columnId: customers.byName["状态"], optionId: "shown" } },
  ];
  for (const [i, definition] of definitions.entries()) {
    const [existing] = await db.select().from(automations).where(and(eq(automations.organizationId, organizationId), eq(automations.workspaceId, workspace.id), eq(automations.name, definition.name), isNull(automations.deletedAt)));
    if (!existing) await createAutomation({ ...scope, ...definition, enabled: true, conditions: [], conditionLogic: "and", actions: [actions[i]] });
  }
  const summary = { organizationId, customersTableId: customers.id, listingsTableId: listings.id, agentUserId, automations: definitions.map(d => d.name) };
  console.log(JSON.stringify(summary, null, 2));
  console.log("演示：向房产经纪人查询今日跟进；把客户状态改为已约看、再改为已带看，检查运行记录和跟进邮件草稿。需要配置 Pi 模型并运行 worker。");
  console.log("未创建 send_email 自动化：connectionId 必须是真实 UUID。实时发送需先在 Settings 连接 AgentMail 并选择组织邮箱；见 docs/brand/scenario-a-real-estate.md。样例数据不代表已发送邮件。");
  return summary;
}

async function main() {
  const demo = await seedDemoUser();
  await seedScenarioA(demo.organizationId);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  withNodeResources(main).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => client.end());
}
