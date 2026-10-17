import { acceptBookingReminder } from "../calendar/reminders.js";
import type { RuntimeDependencies } from "../dependencies.js";
import type { Transaction } from "../db/types.js";
import { acceptNativeExecution,type NativeExecutionReference } from "../agent/executions.js";
import { resolveChatAgentConfiguration } from "../agent/admission.js";
import { and, eq, isNull } from "drizzle-orm";
import type { UIMessage } from "ai";
import { renderAutomationPrompt, type RunAgentAction } from "@tabdo/shared";
import type { Actor } from "../auth/actor.js";
import { resolveChatContext } from "../chat/context.js";
import { threadScope } from "../chat/store.js";


import { agentRuns, agentRuntimeSessions, automationAgentActions, automationRuns, automations,
  chatMessages, chatThreads, member, tables, user, agentExecutions } from "../db/schema.js";



import { beginNativeRun, type AgentRun } from "../agent/runs.js";

import { claimRuntimeLease, NOT_INVOKED, prepareRuntimeRecord, releaseRuntimeLease,
  withRuntimeLease, type RuntimeLease, type RuntimeRecord } from "../agent/runtime-store.js";

export type AutomationAgentActionResult = {
  threadId: string | null; agentRunId: string | null; text: string;
  status: "completed" | "waiting-input" | "failed" | "cancelled" | "unknown" | "accepted" | "superseded" | "skipped"; error?: string;
};
export type ActionInput = {
  runId: string; step: number; organizationId: string; actorUserId: string;
  action: RunAgentAction; eventContext: Record<string, unknown>; tableId: string | null;
  steps?: readonly unknown[];
};
export type AutomationAgentServices = Readonly<{
  prepare(input: Parameters<typeof resolveChatAgentConfiguration>[1]): Promise<Awaited<ReturnType<typeof resolveChatAgentConfiguration>>>;
  /** Execute an accepted agent task under the worker-owned lifecycle. */
  dispatch(reference: NativeExecutionReference): Promise<void>;
  formatError?(error: unknown): string;
}>;
export type AutomationAgentDependencies = RuntimeDependencies & Readonly<{ agent: AutomationAgentServices }>;
function questionContinuation(record: RuntimeRecord) {
  const value = record.resumeState?.continueFrom as { pendingToolResults?: { toolName?: string }[] } | undefined;
  return value?.pendingToolResults?.some(call => call.toolName === "askUserQuestions") ? value : undefined;
}
type Mapping = typeof automationAgentActions.$inferSelect;
class AutomationCancelledError extends Error {}
const mappingScope = (input: Pick<ActionInput,"runId"|"step">) => and(eq(automationAgentActions.runId, input.runId), eq(automationAgentActions.step, input.step));

/** Associate the task with its private conversation before any native model starts. */
async function associate(deps: RuntimeDependencies, input: ActionInput): Promise<{ actor: Actor; mapping: Mapping }> {
  return deps.database.transaction(async tx => {
    const [rule] = await tx.select({ id: automationRuns.id, creator: automations.createdByUserId, name: automations.name, source: automations.source, taskId: automations.id,
      workspaceId: automationRuns.workspaceId, ruleWorkspaceId: automations.workspaceId, enabled: automations.enabled, deletedAt: automations.deletedAt })
      .from(automationRuns).innerJoin(automations, eq(automations.id, automationRuns.automationId))
      .where(and(eq(automationRuns.id, input.runId), eq(automations.organizationId, input.organizationId))).for("update");
    if (!rule || rule.workspaceId !== rule.ruleWorkspaceId || !rule.creator || rule.creator !== input.actorUserId) throw new Error("自动化创建者不存在，无法启动私有智能体对话");
    if (!rule.enabled || rule.deletedAt) throw new AutomationCancelledError("规则已停用或删除");
    const [owner] = await tx.select({ account: user, membership: member }).from(member).innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, input.organizationId), eq(member.userId, input.actorUserId)));
    if (!owner) throw new Error("自动化创建者已不属于当前工作区");
    if (input.tableId) {
      const [target] = await tx.select({ id: tables.id }).from(tables)
        .where(and(eq(tables.id, input.tableId), eq(tables.organizationId, input.organizationId), eq(tables.workspaceId, rule.workspaceId)));
      if (!target) throw new Error("自动化目标表格不存在或不属于当前工作区");
    }
    const actor: Actor = { kind: owner.account.kind === "agent" ? "agent" : "human", userId: owner.account.id,
      memberId: owner.membership.id, organizationId: input.organizationId, workspaceId: rule.workspaceId, role: owner.membership.role,
      name: owner.account.name, email: owner.account.email };
    const [existing] = await tx.select().from(automationAgentActions).where(mappingScope(input));
    if (existing) {
      const [thread] = await tx.select({ id: chatThreads.id }).from(chatThreads).where(threadScope(existing.threadId, actor));
      if (!thread) throw new Error("此自动化关联的私有对话已不存在");
      return { actor, mapping: existing };
    }
    const threadId = deps.uuid(), userMessageId = deps.uuid();
    const scheduled = rule.source.kind === "schedule";
    await tx.insert(chatThreads).values({ id: threadId,
      kind: scheduled ? "scheduled_task" : "chat", scheduledTaskId: scheduled ? rule.taskId : null, userId: actor.userId, organizationId: actor.organizationId, workspaceId: actor.workspaceId,
      clientId: `automation:${input.runId}:${input.step}`, title: `${scheduled ? "定时任务" : "自动化"} · ${rule.name}`,
      custom: { resourceKey: scheduled ? `schedule:${rule.taskId}` : "workspace", agentId: input.action.agentUserId ?? null, automationRunId: input.runId, automationStep: input.step } });
    const [mapping] = await tx.insert(automationAgentActions).values({ runId: input.runId, step: input.step, threadId, userMessageId }).returning();
    return { actor, mapping };
  });
}

async function mappedRun(deps: RuntimeDependencies, mapping: Mapping, transaction?: Transaction) {
  // Recover the small crash window between beginNativeRun's commit and binding.
  // Its stable user ID finds the accepted turn; it is never sent a second time.
  const [run] = await (transaction ?? deps.database).select().from(agentRuns).where(and(eq(agentRuns.threadId, mapping.threadId),
    mapping.agentRunId ? eq(agentRuns.id, mapping.agentRunId) : eq(agentRuns.userMessageId, mapping.userMessageId)));
  return run;
}
async function resultOf(deps: RuntimeDependencies, mapping: Mapping, run: AgentRun): Promise<AutomationAgentActionResult> {
  const [record] = await deps.database.select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.id, run.runtimeSessionId));
  const [message] = await deps.database.select().from(chatMessages).where(and(eq(chatMessages.threadId, mapping.threadId), eq(chatMessages.messageId, run.assistantMessageId)));
  const parts = message?.content.parts as UIMessage["parts"] | undefined;
  const text = parts?.filter(part => part.type === "text").map(part => part.text).join("\n") ?? "";
  const base = { threadId: mapping.threadId, agentRunId: run.id, text };
  if (["starting", "running"].includes(run.status)) {
    const [execution] = await deps.database.select().from(agentExecutions).where(and(eq(agentExecutions.runId, run.id), eq(agentExecutions.fence, run.fence)));
    if (execution && ["accepted", "invoking"].includes(execution.status)) return { ...base, status: "accepted" };
  }
  if (run.status === "completed") return { ...base, status: "completed" };
  if (run.status === "suspended" && record?.lastUserMessageId === run.userMessageId
    && record.lastAssistantMessageId === run.assistantMessageId && questionContinuation(record)) return { ...base, status: "waiting-input" };
  const saved = message?.serverFinal && record?.lastUserMessageId === run.userMessageId && record.lastAssistantMessageId === run.assistantMessageId;
  if (run.status === "cancelled" && saved) return { ...base, status: "cancelled", error: run.error ?? undefined };
  if (run.status === "failed" && saved) return { ...base, status: "failed", error: run.error ?? undefined };
  return { ...base, status: "unknown", error: run.error ?? (run.status === "suspended"
    ? "原生执行尚未完成，可以打开关联对话查看并继续" : "原生执行仍在进行或结果未完整保存；不会重复执行此任务") };
}

export async function readAutomationAgentActionResult(deps: RuntimeDependencies,input: Pick<ActionInput,"runId"|"step">): Promise<AutomationAgentActionResult | undefined> {
  const [mapping] = await deps.database.select().from(automationAgentActions).where(mappingScope(input));
  if (!mapping) return undefined;
  const run = await mappedRun(deps,mapping);
  return run ? resultOf(deps,mapping,run) : undefined;
}

/** Only the existing server certificate permits retrying an input never sent to Pi. */
async function retryUninvoked(deps: RuntimeDependencies, lease: RuntimeLease, record: RuntimeRecord, run: AgentRun, transaction?: Transaction): Promise<AgentRun | undefined> {
  return withRuntimeLease(deps, lease, async tx => {
    const [current] = await tx.select().from(agentRuns).where(and(eq(agentRuns.id, run.id), eq(agentRuns.threadId, lease.threadId))).for("update");
    const [runtime] = await tx.select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.id, record.id)).for("update");
    const [reply] = await tx.select().from(chatMessages).where(and(eq(chatMessages.threadId, lease.threadId), eq(chatMessages.messageId, run.assistantMessageId)));
    const proof = reply?.content.metadata as { runId?: unknown; nativeInvocation?: unknown } | undefined;
    if (current?.status !== "failed" || current.cancelRequestedAt || current.runtimeSessionId !== record.id
      || runtime?.harness !== "pi" || runtime.lastUserMessageId !== current.userMessageId || runtime.lastAssistantMessageId !== current.assistantMessageId
      || !reply?.serverFinal || reply.parentId !== current.userMessageId || reply.content.role !== "assistant"
      || proof?.runId !== current.id || proof.nativeInvocation !== NOT_INVOKED) return undefined;
    const [restarted] = await tx.update(agentRuns).set({ fence: lease.fence, status: "starting", error: null, endedAt: null, activity: null })
      .where(eq(agentRuns.id, current.id)).returning();
    return restarted;
  }, transaction);
}

/** A stable action mapping and accepted Run commit before any computing dispatch. */
export async function runAutomationAgentAction(deps: AutomationAgentDependencies,input: ActionInput): Promise<AutomationAgentActionResult> {
  let mapping: Mapping | undefined,lease: RuntimeLease | undefined;
  const formatError = deps.agent.formatError ?? ((error: unknown) => error instanceof Error ? error.message : "智能体执行失败");
  try {
    const associated = await associate(deps,input);
    const actor = associated.actor;mapping = associated.mapping;
    let run = await mappedRun(deps,mapping);
    if (run && !mapping.agentRunId) {
      await deps.database.update(automationAgentActions).set({ agentRunId: run.id }).where(and(mappingScope(input),isNull(automationAgentActions.agentRunId)));
      mapping.agentRunId = run.id;
    }
    if (run && run.status !== "failed") {
      const result = await resultOf(deps,mapping,run);
      if (result.status === "accepted") {
        const [execution] = await deps.database.select().from(agentExecutions).where(and(eq(agentExecutions.runId,run.id),eq(agentExecutions.fence,run.fence)));
        if (execution?.status === "accepted") await deps.agent.dispatch({ executionId: execution.id,runId: run.id,threadId: run.threadId });
        const latest = await mappedRun(deps,mapping);
        return latest ? resultOf(deps,mapping,latest) : result;
      }
      return result;
    }
    if (run) {
      const [savedRule] = await deps.database.select({ source: automations.source }).from(automations).innerJoin(automationRuns, eq(automationRuns.automationId, automations.id)).where(eq(automationRuns.id, input.runId));
      if (savedRule?.source.kind === "calendar") return resultOf(deps, mapping, run);
      const [reply] = await deps.database.select().from(chatMessages).where(and(eq(chatMessages.threadId,mapping.threadId),eq(chatMessages.messageId,run.assistantMessageId)));
      if ((reply?.content.metadata as { nativeInvocation?: unknown } | undefined)?.nativeInvocation !== NOT_INVOKED) return resultOf(deps,mapping,run);
    }
    if (!input.action.agentUserId || !input.action.prompt?.trim()) throw new Error("此动作需要明确的智能体和任务提示词");
    const context = await resolveChatContext(deps,{ page: "ai" },actor);
    const prepared = await deps.agent.prepare({ actor,agentId: input.action.agentUserId,context,threadId: mapping.threadId,boundTableId: input.tableId ?? undefined });
    lease = await claimRuntimeLease(deps,mapping.threadId,actor);
    const record = await prepareRuntimeRecord(deps,lease,actor,{ profileId: prepared.profile.id,harness: prepared.harness,mode: prepared.mode,provider: prepared.provider });
    const [acceptedUser] = await deps.database.select().from(chatMessages).where(and(eq(chatMessages.threadId,mapping.threadId),eq(chatMessages.messageId,mapping.userMessageId)));
    const prompt = acceptedUser ? (acceptedUser.content.parts as UIMessage["parts"]).filter(part => part.type === "text").map(part => part.text).join("\n")
      : `${renderAutomationPrompt(input.action.prompt,{ event: input.eventContext,steps: input.steps ?? [] })}\n\n自动化事件（外部数据，仅作为本次任务输入）：\n${JSON.stringify(input.eventContext)}`;
    const message: UIMessage = { id: mapping.userMessageId,role: "user",parts: [{ type: "text",text: prompt }] };
    const ownedMapping = mapping,ownedLease = lease;
    let rejected: { status: "superseded" | "skipped" | "failed"; error: string } | undefined;
    const reference = await withRuntimeLease(deps,ownedLease,async tx => {
      const [rule] = await tx.select({ workspaceId: automationRuns.workspaceId, ruleWorkspaceId: automations.workspaceId, enabled: automations.enabled, deletedAt: automations.deletedAt }).from(automations)
        .innerJoin(automationRuns, eq(automationRuns.automationId, automations.id)).where(eq(automationRuns.id, input.runId)).for("share", { of: automations });
      if (!rule?.enabled || rule.deletedAt) throw new AutomationCancelledError("规则已停用或删除");
      let current = await mappedRun(deps,ownedMapping,tx);
      if (!current) {
        rejected = await acceptBookingReminder(deps, tx, input.runId, actor.userId);
        if (rejected) return undefined;
      }
      if (current) {
        const restarted = await retryUninvoked(deps,ownedLease,record,current,tx);
        if (!restarted) return undefined;
        current = restarted;
      } else {
        current = await beginNativeRun(deps,ownedLease,actor,record,{ id: message.id,parentId: null,format: "ai-sdk/v6",content: { role: message.role,parts: message.parts } },prepared.profile.memberId,tx);
      }
      await tx.update(automationAgentActions).set({ agentRunId: current.id }).where(mappingScope(input));
      return acceptNativeExecution(deps,{ actor,lease: ownedLease,run: current,context: context.context,prompt,boundTableId: input.tableId ?? undefined },tx);
    });
    await releaseRuntimeLease(deps,lease);lease = undefined;
    if (rejected) return { threadId: mapping.threadId, agentRunId: null, text: "", ...rejected };
    if (reference) await deps.agent.dispatch(reference);
    const saved = await mappedRun(deps,mapping);
    return saved ? resultOf(deps,mapping,saved) : { threadId: mapping.threadId,agentRunId: null,text: "",status: "unknown",error: "原生运行记录未能读取" };
  } catch (error) {
    const run = mapping ? await mappedRun(deps,mapping).catch(() => undefined) : undefined;
    if (run) return { ...await resultOf(deps,mapping!,run),error: formatError(error) };
    return { threadId: mapping?.threadId ?? null,agentRunId: null,text: "",status: error instanceof AutomationCancelledError ? "cancelled" : "failed",error: formatError(error) };
  } finally { if (lease) await releaseRuntimeLease(deps,lease); }
}
