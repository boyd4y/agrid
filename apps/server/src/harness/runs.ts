import type { HarnessAgentContinueTurnState } from "@ai-sdk/harness/agent";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { ChatActivity, AgentRunSummary } from "@tabdo/shared";
import type { Actor } from "../auth/actor.js";
import { getDatabase } from "@tabdo/platform/resources";

import { agentRuns, agentRunEvents, chatMessages, chatThreads, agentRuntimeSessions, agentThreadLeases, member } from "../db/schema.js";
import { requireThread, saveMessageInTransaction, threadScope, type StoredMessage } from "../chat/store.js";
import { NOT_INVOKED, withRuntimeLease, type RuntimeLease, type RuntimeRecord } from "./store.js";
export type AgentRun = typeof agentRuns.$inferSelect;
const active = ["starting", "running"] as const;

export async function beginNativeRun(lease: RuntimeLease, actor: Actor, record: RuntimeRecord, message: StoredMessage, agentId: string): Promise<AgentRun> {
  return withRuntimeLease(lease, async (tx) => {
    const [duplicate] = await tx.select().from(agentRuns).where(and(eq(agentRuns.threadId, lease.threadId), eq(agentRuns.userMessageId, message.id)));
    if (duplicate) throw new HTTPException(409, { message: "本条消息已启动过智能体执行，请刷新查看结果；不会重复执行工具" });
    const previousRuns = await tx.select({ id: agentRuns.id, runtimeId: agentRuns.runtimeSessionId, userMessageId: agentRuns.userMessageId, assistantMessageId: agentRuns.assistantMessageId }).from(agentRuns).where(eq(agentRuns.threadId, lease.threadId)).orderBy(desc(agentRuns.startedAt), desc(agentRuns.id)).limit(1);
    if (previousRuns.some((r) => r.runtimeId !== record.id)) throw new HTTPException(409, { message: "切换智能体需要新建对话，已有原生会话属于原智能体" });
    if (record.resumeState && previousRuns.some((r) => r.userMessageId !== record.lastUserMessageId)) throw new HTTPException(409, { message: "上一轮执行因服务中断，暂时无法继续此对话。已有操作结果会保留，请新建对话继续。" });
    if (!record.resumeState) {
      // Only server-certified Pi startup failures may precede a first native turn.
      // Check the entire history: a latest harmless failure cannot hide an older crash.
      const unsafeRuns = await tx.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.threadId, lease.threadId), sql`not (
        ${agentRuns.runtimeSessionId}=${record.id}::uuid and ${agentRuns.status} in ('failed','cancelled') and exists (
          select 1 from ${chatMessages} where ${chatMessages.threadId}=${agentRuns.threadId}
          and ${chatMessages.messageId}=${agentRuns.assistantMessageId}::text and ${chatMessages.parentId}=${agentRuns.userMessageId}
          and ${chatMessages.serverFinal}=true and ${chatMessages.content}->>'role'='assistant'
          and ${chatMessages.content}->'metadata'->>'nativeInvocation'=${NOT_INVOKED}
          and ${chatMessages.content}->'metadata'->>'runId'=${agentRuns.id}::text
        ))`)).limit(1);
      const unsafeReplies = await tx.select({ id: chatMessages.id }).from(chatMessages).where(and(eq(chatMessages.threadId, lease.threadId), sql`${chatMessages.content}->>'role'='assistant'`, sql`not (
        ${chatMessages.serverFinal}=true and ${chatMessages.content}->'metadata'->>'nativeInvocation'=${NOT_INVOKED}
        and exists (select 1 from ${agentRuns} where ${agentRuns.threadId}=${chatMessages.threadId}
          and ${agentRuns.runtimeSessionId}=${record.id}::uuid and ${agentRuns.status} in ('failed','cancelled')
          and ${agentRuns.assistantMessageId}::text=${chatMessages.messageId} and ${agentRuns.userMessageId}=${chatMessages.parentId}
          and ${agentRuns.id}::text=${chatMessages.content}->'metadata'->>'runId')
      )`)).limit(1);
      const safeFailures = record.harness === "pi" && Boolean(previousRuns.length && record.lastAssistantMessageId
        && previousRuns[0].userMessageId === record.lastUserMessageId && previousRuns[0].assistantMessageId === record.lastAssistantMessageId);
      if (unsafeRuns.length || unsafeReplies.length || (previousRuns.length && !safeFailures)) throw new HTTPException(409, { message: "此对话暂时无法继续，历史消息已保留；请新建对话继续。" });
    }
    // A replica died before committing its checkpoint. Do not replay its side effects.
    await tx.update(agentRuns).set({ status: "failed", error: "执行进程已中断，结果未完整保存；请核对已完成的数据修改", endedAt: new Date() })
      .where(and(eq(agentRuns.threadId, lease.threadId), inArray(agentRuns.status, [...active]), sql`${agentRuns.fence}<${lease.fence}`));
    // UI history is a projection, not the native session's execution history.
    // Older clients may have stored an unaccepted user message after HTTP failure.
    const canonicalMessage = { ...message, parentId: record.lastAssistantMessageId ?? null };
    const messageScope = and(eq(chatMessages.threadId, lease.threadId), eq(chatMessages.messageId, message.id));
    const [existing] = await tx.select().from(chatMessages).where(messageScope);
    if (existing) {
      if (existing.serverFinal || existing.content.role !== "user") throw new HTTPException(409, { message: "消息 ID 已被使用，请发送新消息" });
      // duplicate Run was checked above: only an uninvoked user can be reparented.
      await tx.update(chatMessages).set({ parentId: canonicalMessage.parentId }).where(messageScope);
    }
    await saveMessageInTransaction(tx, lease.threadId, actor, canonicalMessage);
    const [thread] = await tx.select().from(chatThreads).where(threadScope(lease.threadId, actor));
    await tx.update(chatThreads).set({ custom: { ...thread.custom, agentId }, headId: message.id, lastMessageAt: new Date(), updatedAt: new Date() }).where(threadScope(lease.threadId, actor));
    const [run] = await tx.insert(agentRuns).values({ id: randomUUID(), threadId: lease.threadId, runtimeSessionId: record.id, userMessageId: message.id, assistantMessageId: randomUUID(), fence: lease.fence }).returning();
    return run;
  });
}

export async function recordRunActivity(lease: RuntimeLease, runId: string, activity: ChatActivity) {
  return withRuntimeLease(lease, async (tx) => {
    const [updated] = await tx.update(agentRuns).set({ activity, ...(activity.phase === "finished" ? {} : { status: "running" as const }) })
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.fence, lease.fence),
        ...(activity.phase === "finished" ? [] : [inArray(agentRuns.status, [...active])]))).returning({ id: agentRuns.id });
    if (!updated) {
      const [current] = await tx.select({ fence: agentRuns.fence, status: agentRuns.status }).from(agentRuns).where(eq(agentRuns.id, runId));
      // Native lifecycle callbacks can finish after checkpoint/failure commits.
      // An observation must never resurrect a terminal Run as running.
      if (current?.fence === lease.fence && !active.includes(current.status as typeof active[number])) return false;
      throw new HTTPException(409, { message: "运行已被接管" });
    }
    await tx.insert(agentRunEvents).values({ runId, activity });
    return true;
  });
}

export async function failNativeRun(lease: RuntimeLease, runId: string, error: string) {
  await withRuntimeLease(lease, async (tx) => {
    const [run] = await tx.update(agentRuns).set({ status: "failed", error, endedAt: new Date() }).where(and(eq(agentRuns.id, runId), eq(agentRuns.fence, lease.fence))).returning({ runtimeId: agentRuns.runtimeSessionId });
    if (run) await tx.update(agentRuntimeSessions).set({ status: "failed", error, updatedAt: new Date() }).where(eq(agentRuntimeSessions.id, run.runtimeId));
  });
}

export async function runCancellationRequested(runId: string): Promise<boolean> {
  const [run] = await getDatabase().select({ cancelled: agentRuns.cancelRequestedAt }).from(agentRuns).where(eq(agentRuns.id, runId));
  return Boolean(run?.cancelled);
}

export async function listNativeRuns(threadId: string, actor: Actor) {
  await requireThread(threadId, actor);
  return getDatabase().transaction(async (tx) => {
    // Synchronize with a host mutation/renewal before deciding its owner died.
    // The database clock is evaluated after the row lock, not on the caller host.
    await tx.select().from(agentThreadLeases).where(eq(agentThreadLeases.threadId, threadId)).for("update");
    const failed = await tx.update(agentRuns).set({ status: "failed", error: "执行进程已中断，结果未完整保存；请核对已完成的数据修改", endedAt: new Date() })
      .where(and(eq(agentRuns.threadId, threadId), inArray(agentRuns.status, [...active]), sql`not exists (
        select 1 from ${agentThreadLeases} where ${agentThreadLeases.threadId}=${agentRuns.threadId}
        and ${agentThreadLeases.fence}=${agentRuns.fence} and ${agentThreadLeases.token} is not null
        and ${agentThreadLeases.expiresAt}>clock_timestamp()
      ) and not exists (
        select 1 from agent_executions where run_id=${agentRuns.id}
        and fence=${agentRuns.fence} and status='accepted'
      )`)).returning({ runtimeId: agentRuns.runtimeSessionId });
    if (failed.length) await tx.update(agentRuntimeSessions).set({ status: "failed", error: "执行进程已中断，结果未完整保存", updatedAt: new Date() }).where(inArray(agentRuntimeSessions.id, failed.map((r) => r.runtimeId)));
    const runs = await tx.select().from(agentRuns).where(eq(agentRuns.threadId, threadId)).orderBy(desc(agentRuns.startedAt), desc(agentRuns.id)).limit(30);
    const [record] = runs.length ? await tx.select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.id, runs[0].runtimeSessionId)) : [];
    return runs.map((run, index): AgentRunSummary => ({
      id: run.id, threadId: run.threadId, userMessageId: run.userMessageId, assistantMessageId: run.assistantMessageId,
      status: run.status, activity: run.activity, error: run.error,
      startedAt: run.startedAt.toISOString(), endedAt: run.endedAt?.toISOString() ?? null,
      cancelRequestedAt: run.cancelRequestedAt?.toISOString() ?? null,
      pendingQuestionCallIds: index === 0 && record?.lastAssistantMessageId === run.assistantMessageId
        ? ((record?.resumeState?.continueFrom as HarnessAgentContinueTurnState | undefined)?.pendingToolResults ?? []).filter(call => call.toolName === "askUserQuestions").map(call => call.toolCallId) : [],
      canContinue: index === 0 && !active.includes(run.status as typeof active[number]) && Boolean(record?.resumeState?.continueFrom)
        && record?.lastUserMessageId === run.userMessageId && record?.lastAssistantMessageId === run.assistantMessageId,
    }));
  });
}

export async function requestRunCancellation(threadId: string, runId: string, actor: Actor) {
  return getDatabase().transaction(async tx => {
    // Revocation and this write serialize on the same membership row.
    const [membership] = await tx.select({ id: member.id }).from(member)
      .where(and(eq(member.userId, actor.userId), eq(member.organizationId, actor.organizationId))).for("share");
    const [thread] = await tx.select({ id: chatThreads.id }).from(chatThreads).where(threadScope(threadId, actor));
    if (!membership || !thread) throw new HTTPException(404, { message: "对话不存在" });
    const [run] = await tx.select({ id: agentRuns.id }).from(agentRuns)
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.threadId, threadId)));
    if (!run) throw new HTTPException(404, { message: "执行记录不存在" });
    await tx.update(agentRuns).set({ cancelRequestedAt: new Date() })
      .where(and(eq(agentRuns.id, runId), inArray(agentRuns.status, [...active])));
    return { ok: true };
  });
}

export async function listNativeRunEvents(threadId: string, runId: string, actor: Actor) {
  await requireThread(threadId, actor);
  const [run] = await getDatabase().select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.threadId, threadId), eq(agentRuns.id, runId)));
  if (!run) throw new HTTPException(404, { message: "执行记录不存在" });
  return getDatabase().select().from(agentRunEvents).where(eq(agentRunEvents.runId, runId)).orderBy(desc(agentRunEvents.createdAt), desc(agentRunEvents.id)).limit(200);
}
