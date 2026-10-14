import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { UIMessage } from "ai";
import { renderAutomationPrompt, type RunAgentAction } from "@tabdo/shared";
import type { Actor } from "../auth/actor.js";
import { resolveChatContext } from "../chat/context.js";
import { threadScope } from "../chat/store.js";
import { getDatabase } from "@tabdo/backend/resources";

import { agentRuns, agentRuntimeSessions, automationAgentActions, automationRuns, automations,
  chatMessages, chatThreads, member, tables, user } from "../db/schema.js";
import { chatErrorText } from "../ai/errors.js";
import { executeNativeRun } from "../harness/execution.js";
import { prepareNativeChatAgent } from "../harness/preparation.js";
import { beginNativeRun, type AgentRun } from "../harness/runs.js";
import { questionContinuation } from "../harness/questions.js";
import { claimRuntimeLease, NOT_INVOKED, prepareRuntimeRecord, releaseRuntimeLease,
  withRuntimeLease, type RuntimeLease, type RuntimeRecord } from "../harness/store.js";

export type AutomationAgentActionResult = {
  threadId: string | null; agentRunId: string | null; text: string;
  status: "completed" | "waiting-input" | "failed" | "cancelled" | "unknown"; error?: string;
};
type ActionInput = {
  runId: string; step: number; organizationId: string; actorUserId: string;
  action: RunAgentAction; eventContext: Record<string, unknown>; tableId: string | null;
  steps?: readonly unknown[];
};
type Mapping = typeof automationAgentActions.$inferSelect;
const mappingScope = (input: ActionInput) => and(eq(automationAgentActions.runId, input.runId), eq(automationAgentActions.step, input.step));

/** Associate the task with its private conversation before any native model starts. */
async function associate(input: ActionInput): Promise<{ actor: Actor; mapping: Mapping }> {
  return getDatabase().transaction(async tx => {
    const [rule] = await tx.select({ id: automationRuns.id, creator: automations.createdByUserId, name: automations.name, source: automations.source, taskId: automations.id })
      .from(automationRuns).innerJoin(automations, eq(automations.id, automationRuns.automationId))
      .where(and(eq(automationRuns.id, input.runId), eq(automations.organizationId, input.organizationId))).for("update");
    if (!rule || !rule.creator || rule.creator !== input.actorUserId) throw new Error("自动化创建者不存在，无法启动私有智能体对话");
    const [owner] = await tx.select({ account: user, membership: member }).from(member).innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, input.organizationId), eq(member.userId, input.actorUserId)));
    if (!owner) throw new Error("自动化创建者已不属于当前工作区");
    if (input.tableId) {
      const [target] = await tx.select({ id: tables.id }).from(tables)
        .where(and(eq(tables.id, input.tableId), eq(tables.organizationId, input.organizationId)));
      if (!target) throw new Error("自动化目标表格不存在或不属于当前工作区");
    }
    const actor: Actor = { kind: owner.account.kind === "agent" ? "agent" : "human", userId: owner.account.id,
      memberId: owner.membership.id, organizationId: input.organizationId, role: owner.membership.role,
      name: owner.account.name, email: owner.account.email };
    const [existing] = await tx.select().from(automationAgentActions).where(mappingScope(input));
    if (existing) {
      const [thread] = await tx.select({ id: chatThreads.id }).from(chatThreads).where(threadScope(existing.threadId, actor));
      if (!thread) throw new Error("此自动化关联的私有对话已不存在");
      return { actor, mapping: existing };
    }
    const threadId = randomUUID(), userMessageId = randomUUID();
    const scheduled = rule.source.kind === "schedule";
    await tx.insert(chatThreads).values({ id: threadId,
      kind: scheduled ? "scheduled_task" : "chat", scheduledTaskId: scheduled ? rule.taskId : null, userId: actor.userId, organizationId: actor.organizationId,
      clientId: `automation:${input.runId}:${input.step}`, title: `${scheduled ? "定时任务" : "自动化"} · ${rule.name}`,
      custom: { resourceKey: scheduled ? `schedule:${rule.taskId}` : "workspace", agentId: input.action.agentUserId ?? null, automationRunId: input.runId, automationStep: input.step } });
    const [mapping] = await tx.insert(automationAgentActions).values({ runId: input.runId, step: input.step, threadId, userMessageId }).returning();
    return { actor, mapping };
  });
}

async function mappedRun(mapping: Mapping) {
  // Recover the small crash window between beginNativeRun's commit and binding.
  // Its stable user ID finds the accepted turn; it is never sent a second time.
  const [run] = await getDatabase().select().from(agentRuns).where(and(eq(agentRuns.threadId, mapping.threadId),
    mapping.agentRunId ? eq(agentRuns.id, mapping.agentRunId) : eq(agentRuns.userMessageId, mapping.userMessageId)));
  return run;
}
async function resultOf(mapping: Mapping, run: AgentRun): Promise<AutomationAgentActionResult> {
  const [record] = await getDatabase().select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.id, run.runtimeSessionId));
  const [message] = await getDatabase().select().from(chatMessages).where(and(eq(chatMessages.threadId, mapping.threadId), eq(chatMessages.messageId, run.assistantMessageId)));
  const parts = message?.content.parts as UIMessage["parts"] | undefined;
  const text = parts?.filter(part => part.type === "text").map(part => part.text).join("\n") ?? "";
  const base = { threadId: mapping.threadId, agentRunId: run.id, text };
  if (run.status === "completed") return { ...base, status: "completed" };
  if (run.status === "suspended" && record?.lastUserMessageId === run.userMessageId
    && record.lastAssistantMessageId === run.assistantMessageId && questionContinuation(record)) return { ...base, status: "waiting-input" };
  const saved = message?.serverFinal && record?.lastUserMessageId === run.userMessageId && record.lastAssistantMessageId === run.assistantMessageId;
  if (run.status === "cancelled" && saved) return { ...base, status: "cancelled", error: run.error ?? undefined };
  if (run.status === "failed" && saved) return { ...base, status: "failed", error: run.error ?? undefined };
  return { ...base, status: "unknown", error: run.error ?? (run.status === "suspended"
    ? "原生执行尚未完成，可以打开关联对话查看并继续" : "原生执行仍在进行或结果未完整保存；不会重复执行此任务") };
}

/** Only the existing server certificate permits retrying an input never sent to Pi. */
async function retryUninvoked(lease: RuntimeLease, record: RuntimeRecord, run: AgentRun): Promise<AgentRun | undefined> {
  return withRuntimeLease(lease, async tx => {
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
  });
}

/** Consume the same native SDK turn used by chat, without HTTP or a second tool loop. */
export async function runAutomationAgentAction(input: ActionInput): Promise<AutomationAgentActionResult> {
  let mapping: Mapping | undefined, lease: RuntimeLease | undefined;
  try {
    const associated = await associate(input);
    const actor = associated.actor;mapping = associated.mapping;
    let run = await mappedRun(mapping);
    if (run && !mapping.agentRunId) {
      await getDatabase().update(automationAgentActions).set({ agentRunId: run.id }).where(and(mappingScope(input), isNull(automationAgentActions.agentRunId)));
      mapping.agentRunId = run.id;
    }
    if (run && run.status !== "failed") return resultOf(mapping, run);
    // Failed executed turns are read, not retried. The later locked certificate
    // check is authoritative; this avoids network preparation for normal failures.
    if (run) {
      const [reply] = await getDatabase().select().from(chatMessages).where(and(eq(chatMessages.threadId, mapping.threadId), eq(chatMessages.messageId, run.assistantMessageId)));
      if ((reply?.content.metadata as { nativeInvocation?: unknown } | undefined)?.nativeInvocation !== NOT_INVOKED) return resultOf(mapping, run);
    }
    if (!input.action.agentUserId || !input.action.prompt?.trim()) throw new Error("此动作需要明确的智能体和任务提示词");
    const context = await resolveChatContext({ page: "ai" }, actor);
    const prepared = await prepareNativeChatAgent({ actor, agentId: input.action.agentUserId, context, boundTableId: input.tableId ?? undefined });
    lease = await claimRuntimeLease(mapping.threadId, actor);
    const record = await prepareRuntimeRecord(lease, actor, { profileId: prepared.profile.id, harness: prepared.harness, mode: prepared.mode });
    const [acceptedUser] = await getDatabase().select().from(chatMessages).where(and(eq(chatMessages.threadId, mapping.threadId), eq(chatMessages.messageId, mapping.userMessageId)));
    const prompt = acceptedUser ? (acceptedUser.content.parts as UIMessage["parts"]).filter(part => part.type === "text").map(part => part.text).join("\n")
      : `${renderAutomationPrompt(input.action.prompt, { event: input.eventContext, steps: input.steps ?? [] })}\n\n自动化事件（外部数据，仅作为本次任务输入）：\n${JSON.stringify(input.eventContext)}`;
    const message: UIMessage = { id: mapping.userMessageId, role: "user", parts: [{ type: "text", text: prompt }] };
    // Another worker may have accepted the stable input while we prepared.
    run = await mappedRun(mapping);
    if (run) {
      const restarted = await retryUninvoked(lease, record, run);
      if (!restarted) return resultOf(mapping, run);
      run = restarted;
    } else {
      run = await beginNativeRun(lease, actor, record, { id: message.id, parentId: null, format: "ai-sdk/v6", content: { role: message.role, parts: message.parts } }, prepared.profile.memberId);
    }
    const nativeRun = run;
    await withRuntimeLease(lease, async tx => {
      await tx.update(automationAgentActions).set({ agentRunId: nativeRun.id }).where(mappingScope(input));
    });
    await executeNativeRun({ actor, lease, record, run, harness: prepared.harness, modelId: prepared.modelId,
      piModel: prepared.piModel, instructions: prepared.system, agentsDocument: prepared.agentsDocument,
      tools: prepared.tools, disabledTools: prepared.disabledTools, skills: prepared.skills, prompt, messages: [message],
      metadata: { agentId: prepared.profile.memberId, harness: prepared.harness, modelId: prepared.modelId, runtime: prepared.mode,
        automationRunId: input.runId, automationStep: input.step } });
    const saved = await mappedRun(mapping);
    return saved ? resultOf(mapping, saved) : { threadId: mapping.threadId, agentRunId: run.id, text: "", status: "unknown", error: "原生运行记录未能读取" };
  } catch (error) {
    const run = mapping ? await mappedRun(mapping).catch(() => undefined) : undefined;
    if (run) return { ...await resultOf(mapping!, run), error: chatErrorText(error) };
    return { threadId: mapping?.threadId ?? null, agentRunId: null, text: "", status: "failed", error: chatErrorText(error) };
  } finally { if (lease) await releaseRuntimeLease(lease); }
}
