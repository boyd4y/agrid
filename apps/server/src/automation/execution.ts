import * as commands from "../commands/index.js";
import { and, asc, eq, inArray, sql, isNull } from "drizzle-orm";
import { validateCell, parseAutomationCommand, resolveAutomationBindings, type AutomationRule, type AutomationAction,
  type AutomationDataCommand, type RunAgentAction } from "@tabdo/shared";
import { getDatabase } from "@tabdo/backend/resources";
import { type Transaction } from "../db/context.js";
import { automationEvents, automationOutbox, automationRuns, automationStepReceipts, automations, rows, tables, member,
  automationAgentActions, agentRuns } from "../db/schema.js";
import { loadTableColumns } from "../commands/formulas.js";
import { eventConditionsMatch, eventBindingContext, type AnyEventSnapshot } from "./events.js";
import { runAutomationAgentAction } from "./agent-action.js";
import { queueName } from "../queue/config.js";

export const terminal = ["completed", "failed", "cancelled", "superseded", "unknown"];
const unfinishedRuns = ["queued", "running", "retrying"];
type EventRow = typeof automationEvents.$inferSelect;
type RunRow = typeof automationRuns.$inferSelect;
export class PermanentError extends Error {}
export class FenceLostError extends Error {}

export async function finishEvent(tx: Transaction, event: EventRow, status: string, error?: string) {
  if (event.finishedAt) return;
  await tx.update(automationEvents).set({ status, error: error ?? null, finishedAt: new Date(), updatedAt: new Date() }).where(eq(automationEvents.id, event.id));
  if (status !== "completed") await tx.update(automationRuns).set({ status, error: error ?? null, finishedAt: new Date() })
    .where(and(eq(automationRuns.eventId, event.id), inArray(automationRuns.status, unfinishedRuns)));
  await tx.update(automationOutbox).set({ status: "done", claimToken: null, claimUntil: null })
    .where(and(eq(automationOutbox.eventId, event.id), eq(automationOutbox.generation, event.generation)));
}
export async function claimExecution(id: string, generation?: number) {
  return getDatabase().transaction(async tx => {
    const [event] = await tx.update(automationEvents).set({ fence: sql`${automationEvents.fence} + 1`, status: "running", updatedAt: new Date() })
      .where(and(eq(automationEvents.id, id), inArray(automationEvents.status, ["matched", "running", "retrying"]),
        ...(generation === undefined ? [] : [eq(automationEvents.generation, generation)]))).returning();
    if (!event) return undefined;
    await tx.update(automationRuns).set({ status: "running", attempts: sql`${automationRuns.attempts} + 1` })
      .where(and(eq(automationRuns.eventId, id), inArray(automationRuns.status, unfinishedRuns)));
    return event.fence;
  });
}
async function scopeValid(tx: Transaction, event: EventRow, run: RunRow, snapshot: AnyEventSnapshot, checkRow = true) {
  const [currentRule] = await tx.select().from(automations).where(eq(automations.id, run.automationId)).for("share");
  if (!currentRule || currentRule.deletedAt || !currentRule.enabled || currentRule.organizationId !== event.organizationId) {
    await tx.update(automationRuns).set({ status: "cancelled", error: "规则已停用或删除", finishedAt: new Date() }).where(eq(automationRuns.id, run.id));return null;
  }
  const actorId = currentRule.createdByUserId ?? (snapshot.protocol === 1 ? snapshot.actorId : null);
  if (actorId) {
    const [membership] = await tx.select().from(member).where(and(eq(member.organizationId, event.organizationId), eq(member.userId, actorId))).for("share");
    if (!membership) { await finishEvent(tx, event, "cancelled", "自动化执行者已不在工作区");return null; }
  } else if (snapshot.protocol === 2) throw new PermanentError("请由工作区成员重新保存此自动化以设置执行者");
  if (snapshot.protocol === 1) {
    const [table] = await tx.select().from(tables).where(eq(tables.id, snapshot.event.tableId)).for("share");
    if (!table || table.organizationId !== event.organizationId) { await finishEvent(tx, event, "cancelled", "来源表格已删除");return null; }
    if (checkRow && event.expectedVersion !== null) {
      const [row] = await tx.select().from(rows).where(eq(rows.id, snapshot.row.id));
      if (!row) { await finishEvent(tx, event, "cancelled", "触发记录已删除");return null; }
      if (row.version !== event.expectedVersion) { await finishEvent(tx, event, "superseded", "触发后记录已更新，取消旧事件写回");return null; }
    }
  }
  return { actorId, currentRule };
}
async function stepsOf(tx: Transaction, runId: string) {
  return (await tx.select().from(automationStepReceipts).where(eq(automationStepReceipts.runId, runId)).orderBy(asc(automationStepReceipts.step))).map(receipt => receipt.result);
}
async function completeStep(tx: Transaction, event: EventRow, run: RunRow, rule: AutomationRule, result: Record<string, unknown>) {
  await tx.insert(automationStepReceipts).values({ runId: run.id, step: run.nextStep, result });
  const complete = run.nextStep + 1 === rule.actions.length;
  await tx.update(automationRuns).set({ nextStep: run.nextStep + 1, status: complete ? "completed" : "running",
    finishedAt: complete ? new Date() : null, error: null, detail: { ...run.detail,
      ...(typeof result.threadId === "string" ? { threadId: result.threadId, agentRunId: result.agentRunId } : {}),
      actions: [...(Array.isArray(run.detail.actions) ? run.detail.actions : []), result] } }).where(eq(automationRuns.id, run.id));
  if (event.rowId) {
    const [row] = await tx.select({ version: rows.version }).from(rows).where(eq(rows.id, event.rowId));
    await tx.update(automationEvents).set({ expectedVersion: row?.version ?? null, updatedAt: new Date() }).where(eq(automationEvents.id, event.id));
  }
}
async function dataAction(tx: Transaction, event: EventRow, action: AutomationAction, context: Record<string, unknown>, steps: readonly unknown[], actorId: string | null) {
  if (action.type === "update_field") {
    if (!event.tableId || !event.rowId || event.expectedVersion === null) throw new PermanentError("更新字段需要有效的触发记录");
    const cols = await loadTableColumns(event.tableId, tx), col = cols.find(col => col.id === action.columnId);
    if (!col || col.type === "formula" || col.type === "rollup") throw new PermanentError("动作字段不存在或为只读");
    const invalid = validateCell(col.type, action.value, col.config?.options);
    if (invalid) throw new PermanentError(`动作值无效: ${invalid}`);
    const updated = await commands.updateCellsInTransaction(tx, { rowId: event.rowId, cells: { [col.id]: action.value },
      expectedVersion: event.expectedVersion, organizationId: event.organizationId, skipAutomation: true, actorId: actorId ?? undefined });
    return { type: action.type, columnId: col.id, value: action.value, rowVersion: updated.version };
  }
  if (action.type !== "command") throw new PermanentError("不支持的数据动作");
  let input: Record<string, unknown>;
  try { input = parseAutomationCommand(action.command, resolveAutomationBindings(action.input, { event: context, steps })) as unknown as Record<string, unknown>; }
  catch (error) { throw new PermanentError(error instanceof Error ? error.message : "动作输入无效"); }
  const fn = commands[action.command] as unknown as (input: Record<string, unknown>, tx: Transaction) => Promise<unknown>;
  const result = await fn({ ...input, organizationId: event.organizationId, actorId: actorId ?? undefined, skipAutomation: true }, tx);
  return { type: action.type, command: action.command, result };
}
type NativePlan = { event: EventRow; run: RunRow; rule: AutomationRule; action: RunAgentAction; actorId: string;
  context: Record<string, unknown>; steps: readonly unknown[] };
/** Data + receipt commit atomically. Native SDK work happens after the short transaction. */
export async function executeNext(id: string, fence: number): Promise<"continue" | "done"> {
  // Provider hydration contacts its fixed API outside event/row transactions.
  const [initial] = await getDatabase().select().from(automationEvents).where(eq(automationEvents.id, id));
  let hydrated: AnyEventSnapshot | undefined;
  if (initial && !initial.finishedAt) {
    const saved = initial.snapshot as unknown as AnyEventSnapshot;
    if (saved.protocol === 2 && saved.event.source.kind === "agentmail" && (saved.event.data.message as Record<string, unknown> | undefined)?.bodyMissing && !(saved.event.data.message as Record<string, unknown> | undefined)?.bodyHydrated) {
      const { hydrateAgentMailEvent } = await import("../integrations/agentmail.js");
      const enriched = await hydrateAgentMailEvent(saved.event);
      hydrated = { ...saved, event: { ...enriched, data: { ...enriched.data, message: { ...(enriched.data.message as Record<string, unknown>), bodyHydrated: true } } } };
    }
  }
  const plan = await getDatabase().transaction(async (tx): Promise<NativePlan | "continue" | "done"> => {
    const [event] = await tx.select().from(automationEvents).where(eq(automationEvents.id, id)).for("update");
    if (!event || event.finishedAt) return "done";
    if (event.fence !== fence) throw new FenceLostError("执行租约已被接管");
    const [run] = await tx.select().from(automationRuns).where(and(eq(automationRuns.eventId, id), inArray(automationRuns.status, unfinishedRuns)))
      .orderBy(asc(automationRuns.createdAt), asc(automationRuns.automationId)).limit(1).for("update");
    if (!run) {
      const pending = await tx.select({ id: automationRuns.id }).from(automationRuns).where(and(eq(automationRuns.eventId, id), isNull(automationRuns.finishedAt)));
      if (pending.length) {
        await tx.update(automationEvents).set({ status: "waiting_input", updatedAt: new Date() }).where(eq(automationEvents.id, id));
        await tx.update(automationOutbox).set({ status: "done", claimToken: null, claimUntil: null }).where(eq(automationOutbox.eventId, id));
      } else {
        const outcomes = await tx.select({ status: automationRuns.status }).from(automationRuns).where(eq(automationRuns.eventId, id));
        const outcome = outcomes.some(run => run.status === "failed") ? "failed" : outcomes.some(run => run.status === "cancelled") ? "cancelled" : "completed";
        await finishEvent(tx, event, outcome);
      }
      return "done";
    }
    const rule = run.ruleSnapshot as unknown as AutomationRule;
    const snapshot = hydrated ?? event.snapshot as unknown as AnyEventSnapshot;
    const scope = await scopeValid(tx, event, run, snapshot, rule.actions[run.nextStep]?.type !== "run_agent");
    if (!scope) return event.finishedAt ? "done" : "continue";
    if (hydrated) await tx.update(automationEvents).set({ snapshot: hydrated as unknown as Record<string, unknown> }).where(eq(automationEvents.id, id));
    const action = rule.actions[run.nextStep];
    if (!action) { await tx.update(automationRuns).set({ status: "completed", finishedAt: new Date() }).where(eq(automationRuns.id, run.id));return "continue"; }
    const steps = await stepsOf(tx, run.id), context = eventBindingContext(snapshot);
    if (snapshot.protocol === 2 && run.nextStep === 0 && !eventConditionsMatch(rule, context)) {
      await tx.update(automationRuns).set({ status: "skipped", finishedAt: new Date(), detail: { ...run.detail, reason: "事件条件未满足" } }).where(eq(automationRuns.id, run.id));
      return "continue";
    }
    if (steps.length !== run.nextStep) throw new PermanentError("动作游标与凭据不一致");
    if (action.type === "run_agent") {
      if (!scope.currentRule.createdByUserId) throw new PermanentError("请重新保存此自动化以设置真实执行者");
      return { event, run, rule, action, actorId: scope.currentRule.createdByUserId, context, steps };
    }
    const result = await dataAction(tx, event, action, context, steps, scope.actorId);
    await completeStep(tx, event, run, rule, result);return "continue";
  });
  if (typeof plan === "string") return plan;
  const result = await runAutomationAgentAction({ runId: plan.run.id, step: plan.run.nextStep, organizationId: plan.event.organizationId,
    actorUserId: plan.actorId, action: plan.action, eventContext: plan.context, steps: plan.steps, tableId: plan.event.tableId });
  return getDatabase().transaction(async tx => {
    const [event] = await tx.select().from(automationEvents).where(eq(automationEvents.id, id)).for("update");
    if (!event || event.finishedAt) return "done";
    if (event.fence !== fence) throw new FenceLostError("执行租约已被接管");
    const [run] = await tx.select().from(automationRuns).where(eq(automationRuns.id, plan.run.id)).for("update");
    if (!run || run.nextStep !== plan.run.nextStep || !unfinishedRuns.includes(run.status)) return "continue";
    if (result.status === "completed") { await completeStep(tx, event, run, plan.rule, { type: "run_agent", ...result });return "continue"; }
    const pending = result.status === "waiting-input" || result.status === "unknown";
    await tx.update(automationRuns).set({ status: result.status === "waiting-input" ? "waiting_input" : result.status,
      error: result.error ?? null, finishedAt: pending ? null : new Date(), detail: { ...run.detail,
        threadId: result.threadId, agentRunId: result.agentRunId, nativeStatus: result.status } }).where(eq(automationRuns.id, run.id));
    return "continue";
  });
}
/** Completion of a native question resumes the remaining actions using the same action mapping. */
export async function reconcileNativeAutomations(limit = 25, organizationId?: string) {
  const candidates = await getDatabase().select({ eventId: automationRuns.eventId, runId: automationRuns.id }).from(automationRuns)
    .innerJoin(automations, eq(automations.id, automationRuns.automationId))
    .innerJoin(automationAgentActions, and(eq(automationAgentActions.runId, automationRuns.id), eq(automationAgentActions.step, automationRuns.nextStep)))
    .innerJoin(agentRuns, eq(agentRuns.id, automationAgentActions.agentRunId))
    .where(and(inArray(automationRuns.status, ["waiting_input", "unknown"]), isNull(automationRuns.finishedAt),
      inArray(agentRuns.status, ["completed", "failed", "cancelled"]),
      ...(organizationId ? [eq(automations.organizationId, organizationId)] : []))).limit(limit);
  for (const candidate of candidates) if (candidate.eventId) await getDatabase().transaction(async tx => {
    const [event] = await tx.select().from(automationEvents).where(eq(automationEvents.id, candidate.eventId!)).for("update");
    if (!event || event.finishedAt || event.status !== "waiting_input") return;
    const changed = await tx.update(automationRuns).set({ status: "queued", error: null }).where(and(eq(automationRuns.id, candidate.runId),
      inArray(automationRuns.status, ["waiting_input", "unknown"]), isNull(automationRuns.finishedAt))).returning();
    if (!changed.length) return;
    const generation = event.generation + 1;
    await tx.update(automationEvents).set({ status: "matched", generation, updatedAt: new Date() }).where(eq(automationEvents.id, event.id));
    await tx.insert(automationOutbox).values({ eventId: event.id, queue: queueName, generation, payload: { protocol: 1, eventId: event.id, generation } })
      .onConflictDoUpdate({ target: [automationOutbox.eventId, automationOutbox.queue], set: { status: "pending", generation,
        payload: { protocol: 1, eventId: event.id, generation }, availableAt: new Date(), claimToken: null, claimUntil: null, attempts: 0, publishedAt: null } });
  });
  return candidates.length;
}
export async function recordFailure(id: string, error: Error, final: boolean, fence?: number, generation?: number) {
  await getDatabase().transaction(async tx => {
    const [event] = await tx.select().from(automationEvents).where(eq(automationEvents.id, id)).for("update");
    if (!event || event.finishedAt || (fence !== undefined && event.fence !== fence) || (generation !== undefined && event.generation !== generation)) return;
    if (final) { await finishEvent(tx, event, "failed", error.message);return; }
    await tx.update(automationEvents).set({ status: event.status === "queued" ? "queued" : "retrying", error: error.message, updatedAt: new Date() }).where(eq(automationEvents.id, id));
    await tx.update(automationRuns).set({ status: "retrying", error: error.message }).where(and(eq(automationRuns.eventId, id), inArray(automationRuns.status, unfinishedRuns)));
  });
}
