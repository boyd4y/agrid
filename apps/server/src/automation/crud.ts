import { eq, asc, desc, and, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { automations, automationRuns, automationEvents, automationOutbox, rows, tables } from "../db/schema.js";
import { queueName } from "../queue/config.js";
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
} from "@tabdo/shared";

function mapRule(row: typeof automations.$inferSelect): AutomationRule {
  return {
    id: row.id,
    tableId: row.tableId,
    name: row.name,
    enabled: row.enabled,
    version: row.version,
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
    eventId: row.eventId, attempts: row.attempts, nextStep: row.nextStep,
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

export async function listWorkspaceAutomations(organizationId: string, offset = 0, limit = 100) {
  const hits = await db.select({ rule: automations, sourceName: tables.name }).from(automations)
    .innerJoin(tables, eq(tables.id, automations.tableId))
    .where(and(eq(tables.organizationId, organizationId), isNull(automations.deletedAt)))
    .orderBy(desc(automations.createdAt), desc(automations.id)).limit(limit + 1).offset(offset);
  return { rules: hits.slice(0, limit).map(({ rule, sourceName }) => ({ ...mapRule(rule), sourceName })), hasMore: hits.length > limit };
}

export async function getWorkspaceAutomation(id: string, organizationId: string) {
  const [hit] = await db.select({ rule: automations, sourceName: tables.name }).from(automations)
    .innerJoin(tables, eq(tables.id, automations.tableId))
    .where(and(eq(automations.id, id), eq(tables.organizationId, organizationId), isNull(automations.deletedAt))).limit(1);
  if (!hit) throw new Error("自动化不存在");
  return { ...mapRule(hit.rule), sourceName: hit.sourceName };
}

export async function listAutomations({
  tableId,
  organizationId,
}: ListAutomationsInput & OrgScoped) {
  await assertTable(tableId, organizationId);
  const rows = await db
    .select()
    .from(automations)
    .where(and(eq(automations.tableId, tableId), isNull(automations.deletedAt)))
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
  if (!existing || existing.deletedAt) throw new Error(`自动化不存在: ${input.automationId}`);
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
      version: sql`${automations.version} + 1`,
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
  if (!existing || existing.deletedAt) throw new Error(`自动化不存在: ${automationId}`);
  await assertTable(existing.tableId, organizationId);
  const deleted = await db
    .update(automations).set({ deletedAt: new Date(), enabled: false })
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
    .where(and(eq(automations.tableId, tableId), eq(automations.enabled, true), isNull(automations.deletedAt)));
  return rows.map(mapRule);
}

/** Replay the same saved plan and receipts; completed actions are never reset. */
export async function replayAutomationRun(runId: string, organizationId: string) {
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(automationRuns).where(eq(automationRuns.id, runId));
    if (!run?.eventId || run.status !== "failed") throw new Error("仅支持重放有事件记录的失败运行");
    const [event] = await tx.select().from(automationEvents).where(eq(automationEvents.id, run.eventId)).for("update");
    if (!event || event.organizationId !== organizationId) throw new Error("运行不属于该工作区或事件记录不存在");
    if (event.status !== "failed") throw new Error("该事件仍在执行或不能重放");
    const [row] = await tx.select().from(rows).where(eq(rows.id, event.rowId));
    if (!row || row.version !== event.expectedVersion) throw new Error("记录已更新或删除，请通过新的变更触发自动化");
    const [rule] = await tx.select().from(automations).where(eq(automations.id, run.automationId));
    if (!rule || !rule.enabled || rule.deletedAt) throw new Error("请先启用自动化规则");
    await tx.update(automationRuns).set({ status: "queued", error: null, finishedAt: null }).where(eq(automationRuns.id, runId));
    await tx.update(automationEvents).set({ status: "matched", error: null, finishedAt: null,
      generation: sql`${automationEvents.generation} + 1`,
      fence: sql`${automationEvents.fence} + 1`, updatedAt: new Date() }).where(eq(automationEvents.id, event.id));
    const generation = event.generation + 1;
    await tx.insert(automationOutbox).values({ eventId: event.id, queue: queueName, generation,
      payload: { protocol: 1, eventId: event.id, generation } }).onConflictDoUpdate({
      target: [automationOutbox.eventId, automationOutbox.queue],
      set: { status: "pending", generation, payload: { protocol: 1, eventId: event.id, generation },
        claimToken: null, claimUntil: null, availableAt: sql`now()`, publishedAt: null, attempts: 0, lastError: null },
    });
    return { ok: true as const };
  });
}
