import { eq, asc, desc, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { automations, automationRuns } from "../db/schema.js";
import { requireTableInOrg } from "../tenant/scope.js";
import type {
  AutomationRule,
  AutomationRun,
  CreateAutomationInput,
  UpdateAutomationInput,
  ListAutomationsInput,
  DeleteAutomationInput,
  ListAutomationRunsInput,
  AutomationTrigger,
  AutomationAction,
  FilterCondition,
  FilterLogic,
} from "@table/shared";

function mapRule(row: typeof automations.$inferSelect): AutomationRule {
  return {
    id: row.id,
    tableId: row.tableId,
    name: row.name,
    enabled: row.enabled,
    trigger: row.trigger as AutomationTrigger,
    conditions: (row.conditions ?? []) as FilterCondition[],
    conditionLogic: (row.conditionLogic as FilterLogic) || "and",
    actions: (row.actions ?? []) as AutomationAction[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRun(row: typeof automationRuns.$inferSelect): AutomationRun {
  return {
    id: row.id,
    automationId: row.automationId,
    tableId: row.tableId,
    rowId: row.rowId,
    status: row.status as AutomationRun["status"],
    triggerType: row.triggerType as AutomationRun["triggerType"],
    detail: (row.detail ?? {}) as Record<string, unknown>,
    error: row.error,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}

type OrgScoped = { organizationId?: string };

async function assertTable(tableId: string, organizationId?: string) {
  return requireTableInOrg(tableId, organizationId);
}

export async function listAutomations({
  tableId,
  organizationId,
}: ListAutomationsInput & OrgScoped) {
  await assertTable(tableId, organizationId);
  const rows = await db
    .select()
    .from(automations)
    .where(eq(automations.tableId, tableId))
    .orderBy(asc(automations.createdAt));
  return rows.map(mapRule);
}

export async function createAutomation(input: CreateAutomationInput & OrgScoped) {
  await assertTable(input.tableId, input.organizationId);
  if (!input.name?.trim()) throw new Error("自动化名称不能为空");
  if (!input.trigger?.type) throw new Error("缺少触发器");
  if (!input.actions?.length) throw new Error("至少需要一个动作");

  const [row] = await db
    .insert(automations)
    .values({
      tableId: input.tableId,
      name: input.name.trim(),
      enabled: input.enabled ?? true,
      trigger: input.trigger as never,
      conditions: (input.conditions ?? []) as never,
      conditionLogic: input.conditionLogic ?? "and",
      actions: input.actions as never,
    })
    .returning();
  return mapRule(row);
}

export async function updateAutomation(input: UpdateAutomationInput & OrgScoped) {
  const [existing] = await db
    .select()
    .from(automations)
    .where(eq(automations.id, input.automationId));
  if (!existing) throw new Error(`自动化不存在: ${input.automationId}`);
  await assertTable(existing.tableId, input.organizationId);

  const [row] = await db
    .update(automations)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.trigger !== undefined ? { trigger: input.trigger as never } : {}),
      ...(input.conditions !== undefined
        ? { conditions: input.conditions as never }
        : {}),
      ...(input.conditionLogic !== undefined
        ? { conditionLogic: input.conditionLogic }
        : {}),
      ...(input.actions !== undefined ? { actions: input.actions as never } : {}),
      updatedAt: new Date(),
    })
    .where(eq(automations.id, input.automationId))
    .returning();
  return mapRule(row);
}

export async function deleteAutomation({
  automationId,
  organizationId,
}: DeleteAutomationInput & OrgScoped) {
  const [existing] = await db
    .select()
    .from(automations)
    .where(eq(automations.id, automationId));
  if (!existing) throw new Error(`自动化不存在: ${automationId}`);
  await assertTable(existing.tableId, organizationId);
  const deleted = await db
    .delete(automations)
    .where(eq(automations.id, automationId))
    .returning();
  if (!deleted.length) throw new Error(`自动化不存在: ${automationId}`);
  return { ok: true as const };
}

export async function listAutomationRuns(input: ListAutomationRunsInput & OrgScoped) {
  await assertTable(input.tableId, input.organizationId);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const conds = [eq(automationRuns.tableId, input.tableId)];
  if (input.automationId) {
    conds.push(eq(automationRuns.automationId, input.automationId));
  }
  const rows = await db
    .select()
    .from(automationRuns)
    .where(and(...conds))
    .orderBy(desc(automationRuns.createdAt))
    .limit(limit);
  return rows.map(mapRun);
}

export async function getEnabledAutomations(tableId: string) {
  const rows = await db
    .select()
    .from(automations)
    .where(and(eq(automations.tableId, tableId), eq(automations.enabled, true)));
  return rows.map(mapRule);
}
