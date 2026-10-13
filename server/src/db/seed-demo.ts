import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { and, eq, isNull, like, inArray, sql, count } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { db, client } from "./index.js";
import {
  user,
  account,
  organization,
  member,
  tables,
  columns,
  rows,
  automations,
  agentProfile,
  reports,
  tableViews,
} from "./schema.js";
import { ensureDemoFormView, createBoardView, createGridView } from "../commands/views.js";

/** Fixed local demo credentials — also documented in README */
export const DEMO_EMAIL = "demo@tabdo.ai";
export const DEMO_PASSWORD = "Demo1234!";
export const DEMO_NAME = "Demo User";
export const DEMO_ORG_NAME = "Demo Workspace";
export const DEMO_ORG_SLUG = "demo-workspace";

export const DEMO_BACKLOG_NAME = "产品需求看板";
export const DEMO_CRM_NAME = "客户跟进";
export const DEMO_AGENT_NAME = "产品助理";
export const DEMO_REPORT_NAME = "需求状态概览";

type ColDef = {
  name: string;
  type: string;
  sortOrder: number;
  width: number;
  config: Record<string, unknown>;
};

const BACKLOG_COLS: ColDef[] = [
  { name: "标题", type: "text", sortOrder: 0, width: 220, config: {} },
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
  { name: "负责人", type: "person", sortOrder: 3, width: 120, config: {} },
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
  { name: "预估工时", type: "number", sortOrder: 5, width: 110, config: {} },
  { name: "截止日期", type: "date", sortOrder: 6, width: 140, config: {} },
  { name: "已完成", type: "checkbox", sortOrder: 7, width: 90, config: {} },
  {
    name: "工时×8",
    type: "formula",
    sortOrder: 8,
    width: 110,
    config: { formula: "{预估工时} * 8", formulaResultType: "number" },
  },
];

const BACKLOG_ROWS = [
  { title: "多维表格单元格内编辑", status: "done", priority: "p0", person: "鲁妙子", tags: ["fe", "be"], hours: 8, date: "2026-10-08", done: true },
  { title: "列类型：单选 / 多选 / 日期", status: "doing", priority: "p0", person: "王语嫣", tags: ["fe"], hours: 5, date: "2026-10-12", done: false },
  { title: "PostgreSQL + Drizzle 持久化", status: "done", priority: "p1", person: "Boyd", tags: ["be"], hours: 6, date: "2026-10-10", done: true },
  { title: "乐观更新与错误回滚", status: "todo", priority: "p1", person: "鲁妙子", tags: ["fe"], hours: 4, date: "2026-10-15", done: false },
  { title: "导出 CSV / 公式列（二期）", status: "blocked", priority: "p2", person: "", tags: ["fe", "be"], hours: 12, date: "2026-11-01", done: false },
  { title: "看板拖拽与分组", status: "doing", priority: "p1", person: "Demo User", tags: ["fe"], hours: 6, date: "2026-10-20", done: false },
  { title: "自动化：状态变更勾选", status: "todo", priority: "p2", person: "Boyd", tags: ["be"], hours: 3, date: "2026-10-22", done: false },
];

const CRM_COLS: ColDef[] = [
  { name: "客户名称", type: "text", sortOrder: 0, width: 200, config: {} },
  {
    name: "阶段",
    type: "select",
    sortOrder: 1,
    width: 140,
    config: {
      options: [
        { id: "lead", label: "线索", color: "#ebeced" },
        { id: "qualified", label: "跟进中", color: "#d3e5ef" },
        { id: "proposal", label: "方案", color: "#fadec9" },
        { id: "won", label: "成交", color: "#dbeddb" },
        { id: "lost", label: "流失", color: "#ffe2dd" },
      ],
    },
  },
  { name: "负责人", type: "person", sortOrder: 2, width: 120, config: {} },
  { name: "下次跟进", type: "date", sortOrder: 3, width: 140, config: {} },
  { name: "金额", type: "number", sortOrder: 4, width: 110, config: {} },
];

const CRM_ROWS = [
  { name: "星云科技", stage: "qualified", owner: "Demo User", next: "2026-10-16", amount: 48000 },
  { name: "青禾零售", stage: "proposal", owner: "鲁妙子", next: "2026-10-18", amount: 120000 },
  { name: "北岸设计", stage: "lead", owner: "王语嫣", next: "2026-10-21", amount: 15000 },
  { name: "河图物流", stage: "won", owner: "Boyd", next: "2026-10-10", amount: 86000 },
  { name: "山海教育", stage: "lost", owner: "Demo User", next: "2026-09-30", amount: 22000 },
];

/**
 * Idempotent: create Better Auth email/password user + org membership if missing.
 * Uses the same password hasher as Better Auth so sign-in works.
 */
export async function seedDemoUser(): Promise<{
  userId: string;
  organizationId: string;
  created: boolean;
}> {
  const [existing] = await db
    .select()
    .from(user)
    .where(eq(user.email, DEMO_EMAIL))
    .limit(1);

  let userId: string;
  let created = false;

  if (existing) {
    userId = existing.id;
    const [cred] = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
      .limit(1);
    const hashed = await hashPassword(DEMO_PASSWORD);
    if (cred) {
      await db
        .update(account)
        .set({ password: hashed, updatedAt: new Date() })
        .where(eq(account.id, cred.id));
    } else {
      await db.insert(account).values({
        id: randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: hashed,
      });
    }
  } else {
    userId = randomUUID();
    const hashed = await hashPassword(DEMO_PASSWORD);
    await db.insert(user).values({
      id: userId,
      name: DEMO_NAME,
      email: DEMO_EMAIL,
      emailVerified: true,
      kind: "human",
    });
    await db.insert(account).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: hashed,
    });
    created = true;
  }

  let [org] = await db
    .select()
    .from(organization)
    .where(eq(organization.slug, DEMO_ORG_SLUG))
    .limit(1);

  if (!org) {
    const orgId = randomUUID();
    [org] = await db
      .insert(organization)
      .values({
        id: orgId,
        name: DEMO_ORG_NAME,
        slug: DEMO_ORG_SLUG,
      })
      .returning();
  }

  const [mem] = await db
    .select()
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, org.id)))
    .limit(1);

  if (!mem) {
    await db.insert(member).values({
      id: randomUUID(),
      organizationId: org.id,
      userId,
      role: "owner",
    });
  }

  await db
    .update(tables)
    .set({ organizationId: org.id })
    .where(isNull(tables.organizationId));

  // Remove empty UI placeholder / probe tables
  const placeholders = await db
    .select({ id: tables.id })
    .from(tables)
    .where(
      and(
        eq(tables.organizationId, org.id),
        sql`(${tables.name} LIKE '新表格%' OR ${tables.name} LIKE '探针%' OR ${tables.name} ~ '^表格 [0-9]+$' OR ${tables.name} ~ '^Grid [0-9]+$')`
      )
    );
  if (placeholders.length > 0) {
    const ids = placeholders.map((t) => t.id);
    await db.delete(rows).where(inArray(rows.tableId, ids));
    await db.delete(columns).where(inArray(columns.tableId, ids));
    await db.delete(automations).where(inArray(automations.tableId, ids));
    await db.delete(tableViews).where(inArray(tableViews.tableId, ids));
    await db.delete(tables).where(inArray(tables.id, ids));
  }

  return { userId, organizationId: org.id, created };
}

async function columnNames(tableId: string): Promise<Set<string>> {
  const cols = await db.select({ name: columns.name }).from(columns).where(eq(columns.tableId, tableId));
  return new Set(cols.map((c) => c.name));
}

async function wipeTableContents(tableId: string) {
  await db.delete(automations).where(eq(automations.tableId, tableId));
  await db.delete(tableViews).where(eq(tableViews.tableId, tableId));
  await db.delete(rows).where(eq(rows.tableId, tableId));
  await db.delete(columns).where(eq(columns.tableId, tableId));
}

async function ensureTableWithSchema(opts: {
  organizationId: string;
  name: string;
  description: string;
  icon?: string;
  pinned?: boolean;
  colDefs: ColDef[];
  requiredNames: string[];
}): Promise<{ id: string; created: boolean; reset: boolean }> {
  const [existing] = await db
    .select()
    .from(tables)
    .where(and(eq(tables.organizationId, opts.organizationId), eq(tables.name, opts.name)))
    .limit(1);

  if (!existing) {
    const [table] = await db
      .insert(tables)
      .values({
        name: opts.name,
        description: opts.description,
        organizationId: opts.organizationId,
        icon: opts.icon ?? null,
        pinned: opts.pinned ?? false,
      })
      .returning();
    await db.insert(columns).values(opts.colDefs.map((c) => ({ ...c, tableId: table.id })));
    return { id: table.id, created: true, reset: false };
  }

  const names = await columnNames(existing.id);
  const missing = opts.requiredNames.filter((n) => !names.has(n));
  if (missing.length > 0) {
    await wipeTableContents(existing.id);
    await db
      .update(tables)
      .set({
        description: opts.description,
        icon: opts.icon ?? existing.icon,
        pinned: opts.pinned ?? existing.pinned,
        updatedAt: new Date(),
      })
      .where(eq(tables.id, existing.id));
    await db.insert(columns).values(opts.colDefs.map((c) => ({ ...c, tableId: existing.id })));
    return { id: existing.id, created: false, reset: true };
  }

  await db
    .update(tables)
    .set({
      description: opts.description,
      icon: opts.icon ?? existing.icon,
      pinned: opts.pinned ?? existing.pinned,
      updatedAt: new Date(),
    })
    .where(eq(tables.id, existing.id));
  return { id: existing.id, created: false, reset: false };
}

async function ensureBacklogRows(tableId: string) {
  const cols = await db.select().from(columns).where(eq(columns.tableId, tableId));
  const byName = Object.fromEntries(cols.map((c) => [c.name, c.id]));
  const [{ value: rowCount }] = await db
    .select({ value: count() })
    .from(rows)
    .where(eq(rows.tableId, tableId));
  if (Number(rowCount) >= BACKLOG_ROWS.length) return Number(rowCount);

  if (Number(rowCount) > 0) {
    await db.delete(rows).where(eq(rows.tableId, tableId));
  }

  await db.insert(rows).values(
    BACKLOG_ROWS.map((r, i) => ({
      tableId,
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
  return BACKLOG_ROWS.length;
}

async function ensureCrmRows(tableId: string) {
  const cols = await db.select().from(columns).where(eq(columns.tableId, tableId));
  const byName = Object.fromEntries(cols.map((c) => [c.name, c.id]));
  const [{ value: rowCount }] = await db
    .select({ value: count() })
    .from(rows)
    .where(eq(rows.tableId, tableId));
  if (Number(rowCount) >= CRM_ROWS.length) return Number(rowCount);

  if (Number(rowCount) > 0) {
    await db.delete(rows).where(eq(rows.tableId, tableId));
  }

  await db.insert(rows).values(
    CRM_ROWS.map((r, i) => ({
      tableId,
      sortOrder: i,
      cells: {
        [byName["客户名称"]]: r.name,
        [byName["阶段"]]: r.stage,
        [byName["负责人"]]: r.owner,
        [byName["下次跟进"]]: r.next,
        [byName["金额"]]: r.amount,
      },
    }))
  );
  return CRM_ROWS.length;
}

async function ensureBacklogAutomations(tableId: string) {
  const cols = await db.select().from(columns).where(eq(columns.tableId, tableId));
  const byName = Object.fromEntries(cols.map((c) => [c.name, c.id]));
  const existing = await db
    .select()
    .from(automations)
    .where(and(eq(automations.tableId, tableId), isNull(automations.deletedAt)));
  if (existing.length >= 2) return existing.length;

  if (existing.length > 0) {
    await db.delete(automations).where(eq(automations.tableId, tableId));
  }

  await db.insert(automations).values([
    {
      tableId,
      name: "进入已完成时勾选",
      enabled: true,
      trigger: { type: "enter_status", columnId: byName["状态"], optionId: "done" },
      conditions: [],
      conditionLogic: "and",
      actions: [{ type: "update_field", value: true, columnId: byName["已完成"] }],
    },
    {
      tableId,
      name: "新建记录默认 P2",
      enabled: true,
      trigger: { type: "row_created" },
      conditions: [],
      conditionLogic: "and",
      actions: [{ type: "update_field", value: "p2", columnId: byName["优先级"] }],
    },
    {
      tableId,
      name: "优先级变 P0 时改标题前缀",
      enabled: false,
      trigger: { type: "field_changed", columnId: byName["优先级"], toValue: "p0" },
      conditions: [],
      conditionLogic: "and",
      actions: [{ type: "update_field", value: "[P0] 紧急需求", columnId: byName["标题"] }],
    },
  ]);
  return 3;
}

async function ensureBoardView(tableId: string, organizationId: string, statusColumnId: string) {
  const views = await db.select().from(tableViews).where(eq(tableViews.tableId, tableId));
  if (views.some((v) => v.type === "board")) return;
  if (!views.some((v) => v.type === "grid")) {
    await createGridView({ tableId, name: "表格", organizationId });
  }
  await createBoardView({
    tableId,
    name: "看板",
    organizationId,
    config: { statusColumnId, hideEmpty: true, density: "comfortable" },
  });
}

async function ensureDemoAgent(organizationId: string) {
  const [existing] = await db
    .select()
    .from(agentProfile)
    .where(and(eq(agentProfile.organizationId, organizationId), eq(agentProfile.displayName, DEMO_AGENT_NAME)))
    .limit(1);
  if (existing) return existing.id;

  const agentUserId = randomUUID();
  const memberId = randomUUID();
  const email = `agent+${agentUserId.replace(/-/g, "").slice(0, 12)}@agents.local`;
  await db.transaction(async (tx) => {
    await tx.insert(user).values({
      id: agentUserId,
      name: DEMO_AGENT_NAME,
      email,
      emailVerified: true,
      kind: "agent",
    });
    await tx.insert(member).values({
      id: memberId,
      organizationId,
      userId: agentUserId,
      role: "member",
    });
    await tx.insert(agentProfile).values({
      userId: agentUserId,
      organizationId,
      memberId,
      displayName: DEMO_AGENT_NAME,
      persona: {
        systemPrompt: "你是产品助理，帮助整理需求、更新表格状态，并简要说明下一步。",
        skillNames: [],
        disabledTools: [],
        defaultHarness: "pi",
        defaultModel: "openrouter/free",
        runtime: "local",
        avatarColor: "#337ea9",
      },
    });
  });
  return agentUserId;
}

function demoReportConfig(tableId: string, statusColumnId: string) {
  const chartId = randomUUID();
  const metricId = randomUUID();
  return {
    description: "按状态统计 Demo 需求（seed）",
    columns: 2 as const,
    widgets: [
      {
        id: metricId,
        type: "metric" as const,
        title: "需求总数",
        width: "half" as const,
        layout: { x: 0, y: 0, w: 4, h: 4 },
        query: { tableId, metric: "count" as const, valueColumnId: null },
      },
      {
        id: chartId,
        type: "chart" as const,
        title: "按状态",
        width: "full" as const,
        layout: { x: 4, y: 0, w: 8, h: 6 },
        query: {
          tableId,
          metric: "count" as const,
          valueColumnId: null,
          groupColumnId: statusColumnId,
          chartType: "bar" as const,
          dateBucket: "month" as const,
        },
      },
    ],
  };
}

async function ensureDemoReport(organizationId: string, tableId: string, statusColumnId: string) {
  const config = demoReportConfig(tableId, statusColumnId);
  const [existing] = await db
    .select()
    .from(reports)
    .where(and(eq(reports.organizationId, organizationId), eq(reports.name, DEMO_REPORT_NAME)))
    .limit(1);
  if (existing) {
    const [row] = await db
      .update(reports)
      .set({ tableId, config, updatedAt: new Date(), version: sql`${reports.version} + 1` })
      .where(eq(reports.id, existing.id))
      .returning();
    return row.id;
  }

  const [row] = await db
    .insert(reports)
    .values({
      organizationId,
      tableId,
      name: DEMO_REPORT_NAME,
      config,
    })
    .returning();
  return row.id;
}

/** Ensure fixed rich demo tables / views / automations / agent / report for UI paths. */
export async function seedRichDemoWorkspace(organizationId: string): Promise<{
  backlogTableId: string;
  crmTableId: string;
  backlogRows: number;
  crmRows: number;
  automations: number;
  agentOk: boolean;
  reportId: string;
}> {
  const backlog = await ensureTableWithSchema({
    organizationId,
    name: DEMO_BACKLOG_NAME,
    description: "多维表格 Demo — 需求 / 状态 / 公式 / 看板",
    icon: "Kanban",
    pinned: true,
    colDefs: BACKLOG_COLS,
    requiredNames: ["标题", "状态", "优先级", "已完成", "预估工时"],
  });
  const backlogRows = await ensureBacklogRows(backlog.id);
  await ensureDemoFormView(backlog.id, organizationId);
  const backlogCols = await db.select().from(columns).where(eq(columns.tableId, backlog.id));
  const statusCol = backlogCols.find((c) => c.name === "状态")!;
  await ensureBoardView(backlog.id, organizationId, statusCol.id);
  const automationCount = await ensureBacklogAutomations(backlog.id);

  const crm = await ensureTableWithSchema({
    organizationId,
    name: DEMO_CRM_NAME,
    description: "客户跟进 Demo — 阶段漏斗",
    icon: "Contact",
    pinned: false,
    colDefs: CRM_COLS,
    requiredNames: ["客户名称", "阶段", "金额"],
  });
  const crmRows = await ensureCrmRows(crm.id);
  await ensureDemoFormView(crm.id, organizationId);
  const crmCols = await db.select().from(columns).where(eq(columns.tableId, crm.id));
  const stageCol = crmCols.find((c) => c.name === "阶段")!;
  await ensureBoardView(crm.id, organizationId, stageCol.id);

  await ensureDemoAgent(organizationId);
  const reportId = await ensureDemoReport(organizationId, backlog.id, statusCol.id);

  return {
    backlogTableId: backlog.id,
    crmTableId: crm.id,
    backlogRows,
    crmRows,
    automations: automationCount,
    agentOk: true,
    reportId,
  };
}

async function main() {
  const demo = await seedDemoUser();
  console.log(
    demo.created
      ? "Demo user created."
      : "Demo user already present (password refreshed)."
  );
  const rich = await seedRichDemoWorkspace(demo.organizationId);
  console.log("Demo login:");
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
  console.log(`  userId:   ${demo.userId}`);
  console.log(`  orgId:    ${demo.organizationId}`);
  console.log("Demo workspace:");
  console.log(`  backlog:  ${DEMO_BACKLOG_NAME} (${rich.backlogTableId}) rows=${rich.backlogRows}`);
  console.log(`  crm:      ${DEMO_CRM_NAME} (${rich.crmTableId}) rows=${rich.crmRows}`);
  console.log(`  automations: ${rich.automations}`);
  console.log(`  agent:    ${DEMO_AGENT_NAME}`);
  console.log(`  report:   ${DEMO_REPORT_NAME} (${rich.reportId})`);
  await client.end();
}

const isMain =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch(async (err) => {
    console.error(err);
    await client.end();
    process.exit(1);
  });
}
