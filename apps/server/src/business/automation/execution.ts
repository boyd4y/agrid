import { z } from "zod";
import { resolveSiteKeyId } from "../data-api/keys.js";
import { authorizeKeyRule, automationGrant } from "../data-api/automations.js";
import * as keyData from "../data-api/data.js";
import { ServiceError } from "../errors.js";
import type { sendAgentMailMessage, replyAgentMailMessage } from "../integrations/agentmail.js";
import { sendAgentMailMessageSchema, replyAgentMailMessageSchema, type MailAutomationAction } from "@tabdo/shared";
import * as commands from "../commands/index.js";
import { and, asc, eq, inArray, sql, isNull } from "drizzle-orm";
import { validateCell, parseAutomationCommand, resolveAutomationBindings, type AutomationRule, type AutomationAction,
  type AutomationDataCommand, type RunAgentAction } from "@tabdo/shared";
import type { CommandDependencies } from "../dependencies.js";
import type { ActionInput,AutomationAgentActionResult } from "./agent-action.js";
import type { ExternalAutomationEvent } from "./events.js";
import { readAutomationAgentActionResult } from "./agent-action.js";
import { type Transaction } from "../db/types.js";
import { automationEvents, automationOutbox, automationRuns, automationStepReceipts, automations, rows, tables, member,
  automationAgentActions, agentRuns, agentRuntimeSessions, chatMessages } from "../db/schema.js";
import { loadTableColumns } from "../commands/formulas.js";
import { eventConditionsMatch, eventBindingContext, type AnyEventSnapshot } from "./events.js";
const zId = (value: unknown) => z.uuid().parse(value);

export type AutomationExecutionDependencies = CommandDependencies & Readonly<{
  sendAgentMailMessage?: (input: Parameters<typeof sendAgentMailMessage>[1]) => ReturnType<typeof sendAgentMailMessage>;
  replyAgentMailMessage?: (input: Parameters<typeof replyAgentMailMessage>[1]) => ReturnType<typeof replyAgentMailMessage>;
  runAgentAction(input: ActionInput): Promise<AutomationAgentActionResult>;
  hydrateAgentMailEvent?(event: ExternalAutomationEvent): Promise<ExternalAutomationEvent>;
}>;


export const terminal = ["completed", "failed", "cancelled", "superseded", "unknown"];
const unfinishedRuns = ["queued", "running", "retrying"];
type EventRow = typeof automationEvents.$inferSelect;
type RunRow = typeof automationRuns.$inferSelect;
export class PermanentError extends Error {}
export class FenceLostError extends Error {}

export async function finishEvent(deps: AutomationExecutionDependencies, tx: Transaction, event: EventRow, status: string, error?: string) {
  if (event.finishedAt) return;
  await tx.update(automationEvents).set({ status, error: error ?? null, finishedAt: deps.now(), updatedAt: deps.now() }).where(eq(automationEvents.id, event.id));
  if (status !== "completed") await tx.update(automationRuns).set({ status, error: error ?? null, finishedAt: deps.now() })
    .where(and(eq(automationRuns.eventId, event.id), inArray(automationRuns.status, unfinishedRuns)));
  await tx.update(automationOutbox).set({ status: "done", claimToken: null, claimUntil: null })
    .where(and(eq(automationOutbox.eventId, event.id), eq(automationOutbox.generation, event.generation)));
}
export async function claimExecution(deps: AutomationExecutionDependencies, id: string, generation?: number) {
  return deps.database.transaction(async tx => {
    const [event] = await tx.update(automationEvents).set({ fence: sql`${automationEvents.fence} + 1`, status: "running", updatedAt: deps.now() })
      .where(and(eq(automationEvents.id, id), inArray(automationEvents.status, ["matched", "running", "retrying"]),
        ...(generation === undefined ? [] : [eq(automationEvents.generation, generation)]))).returning();
    if (!event) return undefined;
    await tx.update(automationRuns).set({ status: "running", attempts: sql`${automationRuns.attempts} + 1` })
      .where(and(eq(automationRuns.eventId, id), inArray(automationRuns.status, unfinishedRuns)));
    return event.fence;
  });
}
async function scopeValid(deps: AutomationExecutionDependencies, tx: Transaction, event: EventRow, run: RunRow, snapshot: AnyEventSnapshot, checkRow = true) {
  const [currentRule] = await tx.select().from(automations).where(eq(automations.id, run.automationId)).for("share");
  if (!currentRule || currentRule.deletedAt || !currentRule.enabled || currentRule.organizationId !== event.organizationId || currentRule.workspaceId !== run.workspaceId || (run.ruleSnapshot?.workspaceId !== undefined && run.ruleSnapshot.workspaceId !== run.workspaceId) || (event.workspaceId !== null && event.workspaceId !== run.workspaceId)) {
    await tx.update(automationRuns).set({ status: "cancelled", error: "规则已停用或删除", finishedAt: deps.now() }).where(eq(automationRuns.id, run.id));return null;
  }
  const actorId = currentRule.createdByUserId ?? (snapshot.protocol === 1 ? snapshot.actorId : null);
  if (actorId) {
    const [membership] = await tx.select().from(member).where(and(eq(member.organizationId, event.organizationId), eq(member.userId, actorId))).for("share");
    if (!membership) { await finishEvent(deps, tx, event, "cancelled", "自动化执行者已不在工作区");return null; }
  } else if (snapshot.protocol !== 1) throw new PermanentError("请由工作区成员重新保存此自动化以设置执行者");
  if (snapshot.protocol === 1) {
    const [table] = await tx.select().from(tables).where(eq(tables.id, snapshot.event.tableId)).for("share");
    if (!table || table.organizationId !== event.organizationId || table.workspaceId !== run.workspaceId) { await finishEvent(deps, tx, event, "cancelled", "来源表格已删除");return null; }
    if (checkRow && event.expectedVersion !== null) {
      const [row] = await tx.select().from(rows).where(eq(rows.id, snapshot.row.id));
      if (!row) { await finishEvent(deps, tx, event, "cancelled", "触发记录已删除");return null; }
      if (row.version !== event.expectedVersion) { await finishEvent(deps, tx, event, "superseded", "触发后记录已更新，取消旧事件写回");return null; }
    }
  }
  return { actorId, currentRule };
}
async function stepsOf(deps: AutomationExecutionDependencies, tx: Transaction, runId: string) {
  return (await tx.select().from(automationStepReceipts).where(eq(automationStepReceipts.runId, runId)).orderBy(asc(automationStepReceipts.step))).map(receipt => receipt.result);
}
async function completeStep(deps: AutomationExecutionDependencies, tx: Transaction, event: EventRow, run: RunRow, rule: AutomationRule, result: Record<string, unknown>) {
  await tx.insert(automationStepReceipts).values({ runId: run.id, step: run.nextStep, result });
  const complete = run.nextStep + 1 === rule.actions.length;
  await tx.update(automationRuns).set({ nextStep: run.nextStep + 1, status: complete ? "completed" : "running",
    finishedAt: complete ? deps.now() : null, error: null, detail: { ...run.detail, awaitingNative: false,
      ...(result.type === "run_agent" && typeof result.threadId === "string" ? { threadId: result.threadId, agentRunId: result.agentRunId } : {}),
      actions: [...(Array.isArray(run.detail.actions) ? run.detail.actions : []), result] } }).where(eq(automationRuns.id, run.id));
  if (event.rowId) {
    const [row] = await tx.select({ version: rows.version }).from(rows).where(eq(rows.id, event.rowId));
    await tx.update(automationEvents).set({ expectedVersion: row?.version ?? null, updatedAt: deps.now() }).where(eq(automationEvents.id, event.id));
  }
}
async function dataAction(deps: AutomationExecutionDependencies, tx: Transaction, event: EventRow, action: AutomationAction, context: Record<string, unknown>, steps: readonly unknown[], actorId: string | null) {
  if (action.type === "update_field") {
    if (!event.tableId || !event.rowId || event.expectedVersion === null) throw new PermanentError("更新字段需要有效的触发记录");
    const cols = await loadTableColumns(deps, event.tableId, tx), col = cols.find(col => col.id === action.columnId);
    if (!col || col.type === "formula" || col.type === "rollup") throw new PermanentError("动作字段不存在或为只读");
    const invalid = validateCell(col.type, action.value, col.config?.options);
    if (invalid) throw new PermanentError(`动作值无效: ${invalid}`);
    const updated = await commands.updateCellsInTransaction(deps, tx, { rowId: event.rowId, cells: { [col.id]: action.value },
      expectedVersion: event.expectedVersion, organizationId: event.organizationId, skipAutomation: true, actorId: actorId ?? undefined });
    return { type: action.type, columnId: col.id, value: action.value, rowVersion: updated.version };
  }
  if (action.type !== "command") throw new PermanentError("不支持的数据动作");
  let input: Record<string, unknown>;
  try { input = parseAutomationCommand(action.command, resolveAutomationBindings(action.input, { event: context, steps })) as unknown as Record<string, unknown>; }
  catch (error) { throw new PermanentError(error instanceof Error ? error.message : "动作输入无效"); }
  const fn = commands[action.command] as unknown as (deps: CommandDependencies, input: Record<string, unknown>, tx: Transaction) => Promise<unknown>;
  const result = await fn(deps, { ...input, organizationId: event.organizationId, actorId: actorId ?? undefined, skipAutomation: true }, tx);
  return { type: action.type, command: action.command, result };
}
/** Resolve and validate before making any provider request. Called outside DB transactions. */
export async function executeMailAction(deps: Pick<AutomationExecutionDependencies, "sendAgentMailMessage" | "replyAgentMailMessage">,
  action: MailAutomationAction, organizationId: string, context: Record<string, unknown>, steps: readonly unknown[]) {
  const { type, ...fields } = action;
  let resolved: unknown;
  try { resolved = resolveAutomationBindings(fields, { event: context, steps }); }
  catch (error) { throw new PermanentError(error instanceof Error ? error.message : "Invalid mail bindings"); }
  try {
    if (type === "send_email") {
      const parsed = sendAgentMailMessageSchema.safeParse(resolved);
      if (!parsed.success) throw new PermanentError(parsed.error.message);
      if (!deps.sendAgentMailMessage) throw new PermanentError("邮件发送服务未配置");
      const result = await deps.sendAgentMailMessage({ ...parsed.data, organizationId });
      return { type, ...result, connectionId: parsed.data.connectionId, inboxId: parsed.data.inboxId };
    }
    const parsed = replyAgentMailMessageSchema.safeParse(resolved);
    if (!parsed.success) throw new PermanentError(parsed.error.message);
    if (!deps.replyAgentMailMessage) throw new PermanentError("邮件回复服务未配置");
    const result = await deps.replyAgentMailMessage({ ...parsed.data, organizationId });
    return { type, ...result, connectionId: parsed.data.connectionId, inboxId: parsed.data.inboxId };
  } catch (error) {
    if (error instanceof ServiceError && error.status >= 400 && error.status < 500)
      throw new PermanentError(error.message);
    throw error;
  }
}
type MailPlan = { event: EventRow; run: RunRow; rule: AutomationRule; action: MailAutomationAction; actorId: string | null; context: Record<string, unknown>; steps: readonly unknown[] };
type NativePlan = { event: EventRow; run: RunRow; rule: AutomationRule; action: RunAgentAction; actorId: string;
  context: Record<string, unknown>; steps: readonly unknown[] };
/** Data + receipt commit atomically. Native SDK work happens after the short transaction. */
export async function executeNext(deps: AutomationExecutionDependencies, id: string, fence: number): Promise<"continue" | "done"> {
  // Provider hydration contacts its fixed API outside event/row transactions.
  const [initial] = await deps.database.select().from(automationEvents).where(eq(automationEvents.id, id));
  let hydrated: AnyEventSnapshot | undefined;
  if (initial && !initial.finishedAt) {
    const saved = initial.snapshot as unknown as AnyEventSnapshot;
    if (![1, 2, 3].includes(saved.protocol)) throw new PermanentError("Unsupported automation event protocol");
    if (saved.protocol === 2 && saved.event.source.kind === "agentmail" && (saved.event.data.message as Record<string, unknown> | undefined)?.bodyMissing && !(saved.event.data.message as Record<string, unknown> | undefined)?.bodyHydrated) {
      if (!deps.hydrateAgentMailEvent) throw new PermanentError("邮件正文服务未配置");
      const enriched = await deps.hydrateAgentMailEvent(saved.event);
      hydrated = { ...saved, event: { ...enriched, data: { ...enriched.data, message: { ...(enriched.data.message as Record<string, unknown>), bodyHydrated: true } } } };
    }
  }
  const plan = await deps.database.transaction(async (tx): Promise<NativePlan | MailPlan | "continue" | "done"> => {
    const [event] = await tx.select().from(automationEvents).where(eq(automationEvents.id, id)).for("update");
    if (!event || event.finishedAt) return "done";
    if (event.fence !== fence) throw new FenceLostError("执行租约已被接管");
    const [run] = await tx.select().from(automationRuns).where(and(eq(automationRuns.eventId, id), inArray(automationRuns.status, unfinishedRuns)))
      .orderBy(asc(automationRuns.createdAt), asc(automationRuns.automationId)).limit(1).for("update");
    if (run?.status === "running" && run.detail.awaitingNative === true) {
      // Preserve existing rule ordering while a native computing attempt runs.
      // SQL owns the waiting state; the queue is free to acknowledge this handoff.
      await tx.update(automationEvents).set({ status: "waiting_input",updatedAt: deps.now() }).where(eq(automationEvents.id,id));
      await tx.update(automationOutbox).set({ status: "done",claimToken: null,claimUntil: null }).where(eq(automationOutbox.eventId,id));
      if (typeof run.detail.threadId === "string") deps.wakeAfterCommit?.(tx, { kind: "native-actions", threadId: run.detail.threadId });
      return "done";
    }
    if (!run) {
      const pending = await tx.select({ id: automationRuns.id }).from(automationRuns).where(and(eq(automationRuns.eventId, id), isNull(automationRuns.finishedAt)));
      if (pending.length) {
        await tx.update(automationEvents).set({ status: "waiting_input", updatedAt: deps.now() }).where(eq(automationEvents.id, id));
        await tx.update(automationOutbox).set({ status: "done", claimToken: null, claimUntil: null }).where(eq(automationOutbox.eventId, id));
      } else {
        const outcomes = await tx.select({ status: automationRuns.status }).from(automationRuns).where(eq(automationRuns.eventId, id));
        const outcome = outcomes.some(run => run.status === "failed") ? "failed" : outcomes.some(run => run.status === "cancelled") ? "cancelled" : "completed";
        await finishEvent(deps, tx, event, outcome);
      }
      return "done";
    }
    const rule = run.ruleSnapshot as unknown as AutomationRule;
    const snapshot = hydrated ?? event.snapshot as unknown as AnyEventSnapshot;
    const action = rule.actions[run.nextStep];
    // A new native action obeys the same stale/deleted-row guard as data actions.
    // Once associated, it may have changed that row itself: reconcile its saved
    // outcome without replaying or rejecting its own completed mutation.
    const [nativeMapping] = action?.type === "run_agent" ? await tx.select({ id: automationAgentActions.runId })
      .from(automationAgentActions).where(and(eq(automationAgentActions.runId, run.id), eq(automationAgentActions.step, run.nextStep))) : [];
    const scope = await scopeValid(deps, tx, event, run, snapshot, !nativeMapping);
    if (!scope) return event.finishedAt ? "done" : "continue";
    if (hydrated) await tx.update(automationEvents).set({ snapshot: hydrated as unknown as Record<string, unknown> }).where(eq(automationEvents.id, id));
    if (!action) { await tx.update(automationRuns).set({ status: "completed", finishedAt: deps.now() }).where(eq(automationRuns.id, run.id));return "continue"; }
    if (scope.currentRule.executionKeyId) {
      try {
        const principal = await resolveSiteKeyId(tx, scope.currentRule.executionKeyId, true);
        if (principal.organizationId !== event.organizationId) throw new ServiceError(403, { message: "Automation key organization changed" });
        const creation = principal.workspacePermissions?.get(run.workspaceId);
        if (!(rule.source.kind === "schedule" ? creation?.canCreateSchedules : creation?.canCreateAutomations) && !automationGrant(principal, rule)?.canUpdate) throw new ServiceError(403, { message: "Automation execution is no longer granted" });
        await authorizeKeyRule(tx, principal, { ...rule, actions: rule.actions.slice(run.nextStep) });
      } catch (error) {
        if (!(error instanceof ServiceError) && !(error instanceof z.ZodError)) throw error;
        await tx.update(automationRuns).set({ status: "cancelled", error: error instanceof Error ? error.message : "Automation key permission was revoked", finishedAt: deps.now() }).where(eq(automationRuns.id, run.id));
        return "continue";
      }
    }
    const steps = await stepsOf(deps, tx, run.id), context = eventBindingContext(snapshot);
    if (snapshot.protocol !== 1 && run.nextStep === 0 && !eventConditionsMatch(rule, context)) {
      await tx.update(automationRuns).set({ status: "skipped", finishedAt: deps.now(), detail: { ...run.detail, reason: "事件条件未满足" } }).where(eq(automationRuns.id, run.id));
      return "continue";
    }
    if (steps.length !== run.nextStep) throw new PermanentError("动作游标与凭据不一致");
    if (action.type === "run_agent") {
      if (!scope.currentRule.createdByUserId) throw new PermanentError("请重新保存此自动化以设置真实执行者");
      return { event, run, rule, action, actorId: scope.currentRule.createdByUserId, context, steps };
    }
    if (action.type === "send_email" || action.type === "reply_email")
      return { event, run, rule, action, actorId: scope.actorId, context, steps };
    let result: Record<string, unknown>;
    if (scope.currentRule.executionKeyId) {
      const principal = await resolveSiteKeyId(tx, scope.currentRule.executionKeyId, true);
      const keyContext = { principal, secret: "", executionKeyId: principal.id, baseUrl: "" };
      const scoped = { ...deps, workspaceId: run.workspaceId };
      const command = action.type === "update_field" ? "updateCells" : action.type === "command" ? action.command : "";
      const input = action.type === "update_field" ? { rowId: event.rowId, cells: { [action.columnId]: action.value }, expectedVersion: event.expectedVersion } : action.type === "command" ? parseAutomationCommand(action.command, resolveAutomationBindings(action.input, { event: context, steps })) as unknown as Record<string, unknown> : {};
      let output: unknown;
      if (command === "addRow") output = await keyData.siteCreateRow(scoped, keyContext, zId(input.tableId), input.cells, {}, tx);
      else {
        const [row] = await tx.select({ tableId: rows.tableId }).from(rows).where(eq(rows.id, zId(input.rowId)));
        if (!row) throw new PermanentError("Automation target record no longer exists");
        if (command === "deleteRow") output = await keyData.siteDeleteRow(scoped, keyContext, row.tableId, zId(input.rowId), tx);
        else output = await keyData.siteUpdateRow(scoped, keyContext, row.tableId, zId(input.rowId), command === "updateCell" ? { [zId(input.columnId)]: input.value } : input.cells, input.expectedVersion as number | undefined, {}, tx);
      }
      result = { type: action.type, command, result: output };
    } else result = await dataAction({ ...deps, workspaceId: run.workspaceId }, tx, event, action, context, steps, scope.actorId);
    await completeStep(deps, tx, event, run, rule, result);return "continue";
  });
  if (typeof plan === "string") return plan;
  if (plan.action.type === "send_email" || plan.action.type === "reply_email") {
    const receipt = await executeMailAction(deps, plan.action, plan.event.organizationId, plan.context, plan.steps);
    // AgentMail outbound is at-least-once: ACK before receipt commit, or fence loss
    // between them, can duplicate a send.
    try {
      return await deps.database.transaction(async tx => {
        const [event] = await tx.select().from(automationEvents).where(eq(automationEvents.id, id)).for("update");
        if (!event || event.finishedAt) return "done";
        if (event.fence !== fence) throw new FenceLostError("执行租约已被接管");
        const [run] = await tx.select().from(automationRuns).where(eq(automationRuns.id, plan.run.id)).for("update");
        if (!run || run.nextStep !== plan.run.nextStep || !unfinishedRuns.includes(run.status)) return "continue";
        await completeStep(deps, tx, event, run, plan.rule, receipt);
        return "continue";
      });
    } catch (error) {
      if (error instanceof FenceLostError) throw error;
      throw new PermanentError("AgentMail accepted the message, but saving the receipt failed; delivery may have succeeded", { cause: error });
    }
  }
  if (plan.action.type !== "run_agent" || !plan.actorId) throw new PermanentError("Invalid native action");
  const result = await deps.runAgentAction({ runId: plan.run.id, step: plan.run.nextStep, organizationId: plan.event.organizationId,
    actorUserId: plan.actorId, action: plan.action, eventContext: plan.context, steps: plan.steps, tableId: plan.event.tableId });
  return deps.database.transaction(async tx => {
    const [event] = await tx.select().from(automationEvents).where(eq(automationEvents.id, id)).for("update");
    if (!event || event.finishedAt) return "done";
    if (event.fence !== fence) throw new FenceLostError("执行租约已被接管");
    const [run] = await tx.select().from(automationRuns).where(eq(automationRuns.id, plan.run.id)).for("update");
    if (!run || run.nextStep !== plan.run.nextStep || !unfinishedRuns.includes(run.status)) return "continue";
    if (result.status === "accepted") {
      await tx.update(automationRuns).set({ status: "running",error: result.error ?? null,detail: { ...run.detail,
        threadId: result.threadId,agentRunId: result.agentRunId,nativeStatus: "accepted",awaitingNative: true } }).where(eq(automationRuns.id,run.id));
      return "continue";
    }
    if (result.status === "completed") { await completeStep(deps, tx, event, run, plan.rule, { type: "run_agent", ...result });return "continue"; }
    const pending = result.status === "waiting-input" || result.status === "unknown";
    await tx.update(automationRuns).set({ status: result.status === "waiting-input" ? "waiting_input" : result.status,
      error: result.error ?? null, finishedAt: pending ? null : deps.now(), detail: { ...run.detail,
        threadId: result.threadId, agentRunId: result.agentRunId, nativeStatus: result.status, awaitingNative: false } }).where(eq(automationRuns.id, run.id));
    return "continue";
  });
}
/** Completion of a native question resumes the remaining actions using the same action mapping. */
export async function reconcileNativeAutomations(deps: AutomationExecutionDependencies, limit = 25, organizationId?: string, threadId?: string) {
  const candidates = await deps.database.select({ eventId: automationRuns.eventId, runId: automationRuns.id,step: automationRuns.nextStep }).from(automationRuns)
    .innerJoin(automations, eq(automations.id, automationRuns.automationId))
    .innerJoin(automationAgentActions, and(eq(automationAgentActions.runId, automationRuns.id), eq(automationAgentActions.step, automationRuns.nextStep)))
    .innerJoin(agentRuns, eq(agentRuns.id, automationAgentActions.agentRunId))
    .innerJoin(agentRuntimeSessions,eq(agentRuntimeSessions.id,agentRuns.runtimeSessionId))
    .leftJoin(chatMessages,and(eq(chatMessages.threadId,agentRuns.threadId),eq(chatMessages.messageId,agentRuns.assistantMessageId)))
    .where(and(inArray(automationRuns.status, ["running", "waiting_input", "unknown"]), isNull(automationRuns.finishedAt),
      sql`(${automationRuns.status}!='running' or coalesce(${automationRuns.detail}->>'awaitingNative','false')='true')`,
      // Filter canonical outcomes before LIMIT: permanently unknown executions
      // must not occupy every reconciliation slot and starve later completions.
      sql`(${agentRuns.status}='completed' or (
        ${agentRuntimeSessions.lastUserMessageId}=${agentRuns.userMessageId}
        and ${agentRuntimeSessions.lastAssistantMessageId}=${agentRuns.assistantMessageId}
        and ((${agentRuns.status} in ('failed','cancelled') and ${chatMessages.serverFinal}=true)
          or (${agentRuns.status}='suspended' and ${automationRuns.status}!='waiting_input'
            and ${agentRuntimeSessions.resumeState}->'continueFrom'->'pendingToolResults'
              @> '[{"toolName":"askUserQuestions"}]'::jsonb))))`,
      ...(organizationId ? [eq(automations.organizationId, organizationId)] : []),
      ...(threadId ? [eq(agentRuns.threadId, threadId)] : []))).limit(limit);
  for (const candidate of candidates) if (candidate.eventId) {
    const native = await readAutomationAgentActionResult(deps,candidate);
    // A failed/abandoned process without a canonical checkpoint is genuinely
    // unknown. Keep it visible without scheduling an endless replay loop.
    if (!native || native.status === "unknown" || native.status === "accepted") continue;
    await deps.database.transaction(async tx => {
    const [event] = await tx.select().from(automationEvents).where(eq(automationEvents.id, candidate.eventId!)).for("update");
    if (!event || event.finishedAt || event.status !== "waiting_input") return;
    const changed = await tx.update(automationRuns).set({ status: "queued", error: null,detail: sql`${automationRuns.detail} || '{"awaitingNative":false}'::jsonb` }).where(and(eq(automationRuns.id, candidate.runId),
      inArray(automationRuns.status, ["running", "waiting_input", "unknown"]), isNull(automationRuns.finishedAt))).returning();
    if (!changed.length) return;
    const generation = event.generation + 1;
    const protocol = event.snapshot.protocol === 3 ? 2 as const : 1 as const;
    await tx.update(automationEvents).set({ status: "matched", generation, updatedAt: deps.now() }).where(eq(automationEvents.id, event.id));
    await tx.insert(automationOutbox).values({ eventId: event.id, queue: deps.automationQueueName, generation, payload: { protocol, eventId: event.id, generation } })
      .onConflictDoUpdate({ target: [automationOutbox.eventId, automationOutbox.queue], set: { status: "pending", generation,
        payload: { protocol, eventId: event.id, generation }, availableAt: deps.now(), claimToken: null, claimUntil: null, attempts: 0, publishedAt: null } });
    deps.wakeAfterCommit?.(tx, { kind: "outbox" });
    });
  }
  return candidates.length;
}
export async function recordFailure(deps: AutomationExecutionDependencies, id: string, error: Error, final: boolean, fence?: number, generation?: number) {
  await deps.database.transaction(async tx => {
    const [event] = await tx.select().from(automationEvents).where(eq(automationEvents.id, id)).for("update");
    if (!event || event.finishedAt || (fence !== undefined && event.fence !== fence) || (generation !== undefined && event.generation !== generation)) return;
    if (final) { await finishEvent(deps, tx, event, "failed", error.message);return; }
    await tx.update(automationEvents).set({ status: event.status === "queued" ? "queued" : "retrying", error: error.message, updatedAt: deps.now() }).where(eq(automationEvents.id, id));
    await tx.update(automationRuns).set({ status: "retrying", error: error.message }).where(and(eq(automationRuns.eventId, id), inArray(automationRuns.status, unfinishedRuns)));
  });
}
