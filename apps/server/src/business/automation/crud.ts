import type { CommandDependencies } from "../dependencies.js";
import { eq, asc, desc, and, isNull, sql } from "drizzle-orm";

import { inTransaction, type Transaction } from "../db/context.js";
import { automations, automationRuns, automationEvents, automationOutbox, rows, tables, member,
  columns, agentProfile, integrationConnections, webhookEndpoints } from "../db/schema.js";

import { requireTableInOrg, requireOrgId } from "../tenant/scope.js";
import { AUTOMATION_CREATE_SCHEMA, AUTOMATION_UPDATE_SCHEMA, AUTOMATION_LIST_SCHEMA, AUTOMATION_RUN_LIST_SCHEMA, parseAutomationCommand, validateAutomationActionReferences,
  type AutomationRule, type AutomationRun, type AutomationSource, type CreateAutomationInput, type UpdateAutomationInput,
  type ListAutomationsInput, type DeleteAutomationInput, type ListAutomationRunsInput } from "@tabdo/shared";
import { schedulePreview, syncSchedule } from "./schedule.js";

type OrgScoped = { organizationId?: string; actorId?: string };
export function mapRule(row: typeof automations.$inferSelect): AutomationRule {
  return { id: row.id, organizationId: row.organizationId, createdByUserId: row.createdByUserId, source: row.source,
    eventConditions: row.eventConditions, tableId: row.tableId, name: row.name, enabled: row.enabled, version: row.version,
    trigger: row.trigger as AutomationRule["trigger"], conditions: row.conditions as AutomationRule["conditions"],
    conditionLogic: row.conditionLogic as AutomationRule["conditionLogic"], actions: row.actions as AutomationRule["actions"],
    createdAt: row.createdAt, updatedAt: row.updatedAt };
}
function mapRun(row: typeof automationRuns.$inferSelect): AutomationRun {
  return { id: row.id, automationId: row.automationId, tableId: row.tableId, rowId: row.rowId,
    status: row.status as AutomationRun["status"], eventId: row.eventId, attempts: row.attempts, nextStep: row.nextStep,
    triggerType: row.triggerType as AutomationRun["triggerType"], detail: row.detail, error: row.error,
    createdAt: row.createdAt, finishedAt: row.finishedAt,
    threadId: typeof row.detail.threadId === "string" ? row.detail.threadId : null };
}
async function ownedRule(deps: CommandDependencies, id: string, organizationId?: string, tx: Transaction | CommandDependencies["database"] = deps.database) {
  if (!organizationId) throw new Error("缺少工作区上下文");
  const [rule] = await tx.select().from(automations).where(and(eq(automations.id, id), eq(automations.organizationId, organizationId), isNull(automations.deletedAt)));
  if (!rule) throw new Error("自动化不存在");
  return rule;
}
async function validateRule(deps: CommandDependencies, tx: Transaction, rule: Pick<AutomationRule, "source" | "trigger" | "conditions" | "actions" | "eventConditions">, organizationId: string) {
  const source = rule.source;
  validateAutomationActionReferences(rule.actions);
  if (!source || (source.kind === "table" && !source.tableId)) throw new Error("请选择自动化来源");
  if (new Set(rule.conditions.map(condition => condition.id)).size !== rule.conditions.length) throw new Error("条件标识不能重复");
  if (new Set(rule.eventConditions.map(condition => condition.id)).size !== rule.eventConditions.length) throw new Error("事件条件标识不能重复");
  if (source.kind === "table") {
    const [table] = await tx.select().from(tables).where(and(eq(tables.id, source.tableId), eq(tables.organizationId, organizationId)));
    if (!table) throw new Error("来源表格不存在");
    if (!["row_created", "field_changed", "enter_status"].includes(rule.trigger.type)) throw new Error("表格来源与触发器不匹配");
    const cols = await tx.select().from(columns).where(eq(columns.tableId, table.id));
    if ("columnId" in rule.trigger) {
      const trigger = rule.trigger;
      const col = cols.find(col => col.id === trigger.columnId);
      if (!col) throw new Error("触发字段不存在");
      if (rule.trigger.type === "enter_status" && (!['select', 'multi_select'].includes(col.type) || !col.config.options?.some(option => trigger.type === "enter_status" && option.id === trigger.optionId))) throw new Error("触发状态选项不存在");
    }
    if (rule.conditions.some(condition => !cols.some(col => col.id === condition.columnId))) throw new Error("条件字段不存在");
    if (rule.eventConditions.length) throw new Error("表格来源请使用字段条件");
    for (const action of rule.actions) if (action.type === "update_field" && !cols.some(col => col.id === action.columnId)) throw new Error("动作字段不存在");
  } else {
    if (rule.conditions.length || rule.actions.some(action => action.type === "update_field")) throw new Error("事件来源请使用事件条件与数据操作动作");
    const expected = { webhook: "webhook_received", agentmail: "message_received", schedule: "schedule_due" }[source.kind];
    if (rule.trigger.type !== expected) throw new Error("来源与触发器不匹配");
    if (source.kind === "webhook") {
      const [endpoint] = await tx.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, source.endpointId), eq(webhookEndpoints.organizationId, organizationId), isNull(webhookEndpoints.deletedAt)));
      if (!endpoint || endpoint.kind !== "webhook") throw new Error("Webhook 来源不存在");
    } else if (source.kind === "agentmail") {
      const [connection] = await tx.select().from(integrationConnections).where(and(eq(integrationConnections.id, source.connectionId), eq(integrationConnections.organizationId, organizationId), isNull(integrationConnections.deletedAt)));
      const endpoints = await tx.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.connectionId, source.connectionId), eq(webhookEndpoints.organizationId, organizationId), isNull(webhookEndpoints.deletedAt)));
      if (!connection || !endpoints.some(endpoint => endpoint.kind === "agentmail" && endpoint.inboxIds.includes(source.inboxId))) throw new Error("请先为此邮箱注册接收事件");
    } else schedulePreview(source.cron, source.timeZone, deps.now());
  }
  for (const condition of rule.eventConditions) {
    // Syntax and prototype checks do not require a live event value.
    if (condition.path.split('.').some(part => !part || ['__proto__','constructor','prototype'].includes(part))) throw new Error("事件字段路径无效");
  }
  for (const action of rule.actions) {
    if (action.type === "run_agent") {
      const [agent] = await tx.select({ id: agentProfile.id }).from(agentProfile)
        .innerJoin(member, eq(member.id, agentProfile.memberId)).where(and(eq(agentProfile.userId, action.agentUserId!), eq(member.organizationId, organizationId)));
      if (!agent) throw new Error("智能体不存在或不属于当前工作区");
    }
    if (action.type === "command") {
      // Fully literal inputs are validated now; references retain their real types and are validated at execution.
      const encoded = JSON.stringify(action.input);
      if (!encoded.includes('"$event"') && !encoded.includes('"$step"')) parseAutomationCommand(action.command, action.input);
      if (Object.hasOwn(action.input, "organizationId") || Object.hasOwn(action.input, "actorId") || Object.hasOwn(action.input, "skipAutomation")) throw new Error("动作不能设置执行身份");
    }
  }
}
export async function listWorkspaceAutomations(deps: CommandDependencies, organizationId: string, offset = 0, limit = 100, kind?: "event" | "schedule") {
  const hits = await deps.database.select({ rule: automations, sourceName: tables.name }).from(automations).leftJoin(tables, eq(tables.id, automations.tableId))
    .where(and(eq(automations.organizationId, organizationId), isNull(automations.deletedAt), kind === "schedule" ? sql`${automations.source}->>'kind' = 'schedule'` : kind === "event" ? sql`${automations.source}->>'kind' <> 'schedule'` : undefined)).orderBy(desc(automations.createdAt), desc(automations.id)).limit(limit + 1).offset(offset);
  return { rules: hits.slice(0, limit).map(({ rule, sourceName }) => ({ ...mapRule(rule), sourceName })), hasMore: hits.length > limit };
}
export async function getWorkspaceAutomation(deps: CommandDependencies, id: string, organizationId: string) {
  const row = await ownedRule(deps, id, organizationId);
  const [sourceTable] = row.tableId ? await deps.database.select({ name: tables.name }).from(tables).where(eq(tables.id, row.tableId)) : [];
  return { ...mapRule(row), sourceName: sourceTable?.name ?? null };
}
export async function listAutomations(deps: CommandDependencies, input: ListAutomationsInput & OrgScoped, transaction?: Transaction) {
  const organizationId = requireOrgId(input.organizationId);
  const { tableId, offset, limit } = AUTOMATION_LIST_SCHEMA.parse({ tableId: input.tableId, offset: input.offset, limit: input.limit });
  if (tableId) await requireTableInOrg(deps, tableId, organizationId, transaction);
  return (await (transaction ?? deps.database).select().from(automations).where(and(eq(automations.organizationId, organizationId),
    tableId ? eq(automations.tableId, tableId) : undefined, isNull(automations.deletedAt)))
    .orderBy(asc(automations.createdAt), asc(automations.id)).limit(limit ?? 100).offset(offset ?? 0)).map(mapRule);
}
export async function createAutomation(deps: CommandDependencies, input: CreateAutomationInput & OrgScoped, transaction?: Transaction) {
  const { organizationId, actorId, ...wire } = input;
  if (!organizationId || !actorId) throw new Error("缺少自动化创建者或工作区上下文");
  const body = AUTOMATION_CREATE_SCHEMA.parse(wire);
  const source: AutomationSource = body.source ?? { kind: "table", tableId: body.tableId! };
  if (body.tableId && (source.kind !== "table" || source.tableId !== body.tableId)) throw new Error("来源表格不一致");
  return inTransaction(deps, transaction, async tx => {
    const [creator] = await tx.select().from(member).where(and(eq(member.userId, actorId), eq(member.organizationId, organizationId)));
    if (!creator) throw new Error("创建者已不在工作区");
    const data = { ...body, source, conditions: body.conditions ?? [], eventConditions: body.eventConditions ?? [], actions: body.actions };
    await validateRule(deps, tx, data, organizationId);
    const [row] = await tx.insert(automations).values({ organizationId, createdByUserId: actorId, source, eventConditions: data.eventConditions,
      tableId: source.kind === "table" ? source.tableId : null, name: body.name, enabled: body.enabled ?? true,
      trigger: body.trigger, conditions: data.conditions, conditionLogic: body.conditionLogic ?? "and", actions: body.actions }).returning();
    const rule = mapRule(row);await syncSchedule(deps, tx, rule);return rule;
  });
}
export async function updateAutomation(deps: CommandDependencies, input: UpdateAutomationInput & OrgScoped, transaction?: Transaction) {
  const { automationId, organizationId, actorId, ...wire } = input;
  const body = AUTOMATION_UPDATE_SCHEMA.parse(wire);
  return inTransaction(deps, transaction, async tx => {
    const existing = await ownedRule(deps, automationId, organizationId, tx);
    const rule = { ...mapRule(existing), ...body };
    if (rule.source.kind !== existing.source.kind || (existing.source.kind === "table" && rule.source.kind === "table" && rule.source.tableId !== existing.source.tableId)) throw new Error("已保存自动化的来源类型不可更改");
    if (body.enabled !== false) await validateRule(deps, tx, rule, existing.organizationId);
    // Migrated rules have no invented owner. A real editor adopts them explicitly.
    const [row] = await tx.update(automations).set({ ...body, createdByUserId: existing.createdByUserId ?? actorId ?? null,
      version: sql`${automations.version} + 1`, updatedAt: deps.now() }).where(eq(automations.id, automationId)).returning();
    const updated = mapRule(row);await syncSchedule(deps, tx, updated);return updated;
  });
}
export async function deleteAutomation(deps: CommandDependencies, { automationId, organizationId }: DeleteAutomationInput & OrgScoped, transaction?: Transaction) {
  return inTransaction(deps, transaction, async tx => {
    await ownedRule(deps, automationId, organizationId, tx);
    const [row] = await tx.update(automations).set({ deletedAt: deps.now(), enabled: false }).where(eq(automations.id, automationId)).returning();
    await syncSchedule(deps, tx, mapRule(row));return { ok: true as const };
  });
}
export async function listRuleRuns(deps: CommandDependencies, automationId: string, organizationId: string, limit = 50) {
  await ownedRule(deps, automationId, organizationId);
  return (await deps.database.select().from(automationRuns).where(eq(automationRuns.automationId, automationId)).orderBy(desc(automationRuns.createdAt)).limit(Math.min(Math.max(limit, 1), 200))).map(mapRun);
}
export async function listAutomationRuns(deps: CommandDependencies, input: ListAutomationRunsInput & OrgScoped, transaction?: Transaction) {
  const organizationId = requireOrgId(input.organizationId);
  const { tableId, automationId, limit } = AUTOMATION_RUN_LIST_SCHEMA.parse({ tableId: input.tableId, automationId: input.automationId, limit: input.limit });
  if (tableId) await requireTableInOrg(deps, tableId, organizationId, transaction);
  if (automationId) {
    const rule = await ownedRule(deps, automationId, organizationId, transaction);
    if (tableId && rule.tableId !== tableId) throw new Error("自动化不属于指定表格");
  }
  return (await (transaction ?? deps.database).select({ run: automationRuns }).from(automationRuns)
    .innerJoin(automations, eq(automations.id, automationRuns.automationId)).where(and(
      eq(automations.organizationId, organizationId), isNull(automations.deletedAt),
      tableId ? eq(automationRuns.tableId, tableId) : undefined,
      automationId ? eq(automationRuns.automationId, automationId) : undefined))
    .orderBy(desc(automationRuns.createdAt), desc(automationRuns.id)).limit(limit ?? 50)).map(hit => mapRun(hit.run));
}
export async function getEnabledAutomations(deps: CommandDependencies, tableId: string) {
  return (await deps.database.select().from(automations).where(and(eq(automations.tableId, tableId), eq(automations.enabled, true), isNull(automations.deletedAt)))).map(mapRule);
}
/** Replay only the same saved plan; committed action receipts are never reset. */
export async function replayAutomationRun(deps: CommandDependencies, runId: string, organizationId: string) {
  return deps.database.transaction(async tx => {
    const [run] = await tx.select().from(automationRuns).where(eq(automationRuns.id, runId));
    if (!run?.eventId || run.status !== "failed") throw new Error("仅支持重放有事件记录的失败运行");
    const [event] = await tx.select().from(automationEvents).where(eq(automationEvents.id, run.eventId)).for("update");
    if (!event || event.organizationId !== organizationId || event.status !== "failed") throw new Error("运行不存在或尚在执行");
    if (event.rowId) {
      const [row] = await tx.select().from(rows).where(eq(rows.id, event.rowId));
      if (!row || row.version !== event.expectedVersion) throw new Error("触发记录已更新或删除");
    }
    const rule = await ownedRule(deps, run.automationId, organizationId, tx);
    if (!rule.enabled) throw new Error("请先启用自动化规则");
    await tx.update(automationRuns).set({ status: "queued", error: null, finishedAt: null }).where(eq(automationRuns.id, runId));
    await tx.update(automationEvents).set({ status: "matched", error: null, finishedAt: null,
      generation: sql`${automationEvents.generation} + 1`, fence: sql`${automationEvents.fence} + 1`, updatedAt: deps.now() }).where(eq(automationEvents.id, event.id));
    const generation = event.generation + 1;
    await tx.insert(automationOutbox).values({ eventId: event.id, queue: deps.automationQueueName, generation, payload: { protocol: 1, eventId: event.id, generation } }).onConflictDoUpdate({
      target: [automationOutbox.eventId, automationOutbox.queue], set: { status: "pending", generation,
        payload: { protocol: 1, eventId: event.id, generation }, claimToken: null, claimUntil: null, availableAt: sql`now()`, publishedAt: null, attempts: 0, lastError: null } });
    deps.wakeAfterCommit?.(tx, { kind: "outbox" });
    return { ok: true as const };
  });
}
