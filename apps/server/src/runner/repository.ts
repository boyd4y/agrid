import { and, asc, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { ToolResultPart, UIMessageChunk } from "ai";
import { z } from "zod";
import { getDatabase } from "@tabdo/platform/resources";
import { agentExecutions, agentExecutionChunks, agentRuns, agentRuntimeSessions, agentThreadLeases, agentProfile, chatThreads, chatMessages, member, user } from "../db/schema.js";
import type { Actor } from "../auth/actor.js";
import { chatContextSchema, type ChatContext } from "../chat/context.js";
import { threadScope } from "../chat/store.js";
import { claimRuntimeLease, releaseRuntimeLease, withRuntimeLease, type RuntimeLease } from "../harness/store.js";
import type { AgentRun } from "../harness/runs.js";

export type NativeExecutionReference = Readonly<{ executionId: string; runId: string; threadId: string }>;
export type AcceptedExecution = typeof agentExecutions.$inferSelect;
export type LoadedNativeExecution = {
  execution: AcceptedExecution;
  run: typeof agentRuns.$inferSelect;
  record: typeof agentRuntimeSessions.$inferSelect;
  profile: typeof agentProfile.$inferSelect;
  thread: typeof chatThreads.$inferSelect;
  membership: typeof member.$inferSelect;
  account: typeof user.$inferSelect;
  actor: Actor;
  lease: RuntimeLease;
};
const active = ["starting", "running"];
const uuid = z.uuid();
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

/** Must be called before any SDK invocation. Lease ownership alone is not acceptance. */
export async function acceptNativeExecution(input: {
  actor: Actor; lease: RuntimeLease; run: AgentRun; context: ChatContext;
  prompt: string; boundTableId?: string; toolResultContinuations?: ToolResultPart[];
}): Promise<NativeExecutionReference> {
  const context = chatContextSchema.parse(input.context);
  const prompt = z.string().max(2_000_000).parse(input.prompt);
  if (input.boundTableId) uuid.parse(input.boundTableId);
  const document = { protocol: 1 as const, context, prompt, ...(input.boundTableId ? { boundTableId: input.boundTableId } : {}),
    ...(input.toolResultContinuations ? { toolResultContinuations: JSON.parse(JSON.stringify(input.toolResultContinuations)) as ToolResultPart[] } : {}) };
  return withRuntimeLease(input.lease, async tx => {
    const [owner] = await tx.select().from(member).where(and(eq(member.userId, input.actor.userId), eq(member.organizationId, input.actor.organizationId))).for("share");
    const [thread] = await tx.select().from(chatThreads).where(threadScope(input.lease.threadId, input.actor));
    const [run] = await tx.select().from(agentRuns).where(and(eq(agentRuns.id, input.run.id), eq(agentRuns.threadId, input.lease.threadId), eq(agentRuns.fence, input.lease.fence))).for("update");
    if (!owner || !thread || !run || !active.includes(run.status)) throw new HTTPException(409, { message: "运行无法接受执行" });
    const [previous] = await tx.select().from(agentExecutions).where(and(eq(agentExecutions.runId, run.id), eq(agentExecutions.fence, input.lease.fence)));
    if (previous) {
      if (JSON.stringify(previous.input) !== JSON.stringify(document)) {
        // JSONB has canonical key ordering; compare parsed values by ordered serialization.
        if (canonical(previous.input) !== canonical(document)) throw new HTTPException(409, { message: "已接受的执行输入不能更换" });
      }
      return { executionId: previous.id, runId: run.id, threadId: run.threadId };
    }
    if (run.activity && !input.toolResultContinuations) throw new HTTPException(409, { message: "运行已开始，不能再次分派" });
    if (input.toolResultContinuations) {
      const [assistant] = await tx.select().from(chatMessages).where(and(eq(chatMessages.threadId, run.threadId), eq(chatMessages.messageId, run.assistantMessageId)));
      const parts = assistant?.content.parts;
      if (!assistant?.serverFinal || !Array.isArray(parts) || !input.toolResultContinuations.length || input.toolResultContinuations.some(result => {
        const part = parts.find(part => part.toolCallId === result.toolCallId && part.state === "output-available");
        return !part || result.output.type !== "json" || canonical(part.output) !== canonical(result.output.value);
      })) throw new HTTPException(409, { message: "原生回答尚未持久接受" });
    }
    const [accepted] = await tx.insert(agentExecutions).values({ runId: run.id, fence: input.lease.fence, leaseToken: input.lease.token, input: document }).returning();
    return { executionId: accepted.id, runId: run.id, threadId: run.threadId };
  });
}

/** Resolves identity from the private accepted Run, never from a queue body principal. */
export async function loadNativeExecution(executionId: string): Promise<LoadedNativeExecution> {
  uuid.parse(executionId);
  const [row] = await getDatabase().select({ execution: agentExecutions, run: agentRuns, record: agentRuntimeSessions, profile: agentProfile, thread: chatThreads,
    membership: member, account: user }).from(agentExecutions)
    .innerJoin(agentRuns, eq(agentRuns.id, agentExecutions.runId))
    .innerJoin(agentRuntimeSessions, eq(agentRuntimeSessions.id, agentRuns.runtimeSessionId))
    .innerJoin(agentProfile, eq(agentProfile.id, agentRuntimeSessions.agentProfileId))
    .innerJoin(chatThreads, eq(chatThreads.id, agentRuns.threadId))
    .innerJoin(member, and(eq(member.userId, chatThreads.userId), eq(member.organizationId, chatThreads.organizationId)))
    .innerJoin(user, eq(user.id, member.userId)).where(eq(agentExecutions.id, executionId));
  if (!row || row.record.threadId !== row.thread.id || row.profile.organizationId !== row.thread.organizationId) throw new HTTPException(404, { message: "执行不存在或创建者已离开工作区" });
  const actor: Actor = { kind: row.account.kind === "agent" ? "agent" : "human", userId: row.account.id, memberId: row.membership.id,
    organizationId: row.membership.organizationId, role: row.membership.role, name: row.account.name, email: row.account.email };
  const lease: RuntimeLease = { threadId: row.thread.id, token: row.execution.leaseToken, fence: row.execution.fence };
  return { ...row, actor, lease };
}

/** Rebind only provably uninvoked durable dispatch after its original lease expires. */
export async function recoverAcceptedNativeExecution(executionId: string): Promise<LoadedNativeExecution> {
  const loaded = await loadNativeExecution(executionId);
  if (loaded.execution.status !== "accepted") return loaded;
  const [owned] = await getDatabase().select({ threadId: agentThreadLeases.threadId }).from(agentThreadLeases).where(and(
    eq(agentThreadLeases.threadId, loaded.thread.id), eq(agentThreadLeases.token, loaded.execution.leaseToken),
    eq(agentThreadLeases.fence, loaded.execution.fence), sql`${agentThreadLeases.expiresAt}>clock_timestamp()`,
  ));
  if (owned) return loaded;
  const lease = await claimRuntimeLease(loaded.thread.id, loaded.actor);
  try {
    await withRuntimeLease(lease, async tx => {
      const [membership] = await tx.select().from(member).where(and(eq(member.userId, loaded.actor.userId), eq(member.organizationId, loaded.actor.organizationId))).for("share");
      const [run] = await tx.select().from(agentRuns).where(eq(agentRuns.id, loaded.run.id)).for("update");
      const [execution] = await tx.select().from(agentExecutions).where(eq(agentExecutions.id, executionId)).for("update");
      if (!membership || !run || !execution || execution.status !== "accepted" || !active.includes(run.status)
        || run.fence !== execution.fence || (run.activity && !execution.input.toolResultContinuations))
        throw new HTTPException(409, { message: "执行无法安全重新分派" });
      await tx.update(agentRuns).set({ fence: lease.fence }).where(eq(agentRuns.id, run.id));
      await tx.update(agentExecutions).set({ fence: lease.fence, leaseToken: lease.token }).where(eq(agentExecutions.id, executionId));
    });
    return await loadNativeExecution(executionId);
  } catch (error) { await releaseRuntimeLease(lease);throw error; }
}

/** The durable invocation fence is committed before the SDK; uncertain starts are never retried. */
export async function claimNativeExecution(loaded: LoadedNativeExecution): Promise<boolean> {
  return withRuntimeLease(loaded.lease, async tx => {
    const [membership] = await tx.select().from(member).where(and(eq(member.userId, loaded.actor.userId), eq(member.organizationId, loaded.actor.organizationId))).for("share");
    if (!membership) throw new HTTPException(403, { message: "创建者已离开工作区" });
    const [run] = await tx.select().from(agentRuns).where(and(eq(agentRuns.id, loaded.run.id), eq(agentRuns.fence, loaded.lease.fence))).for("update");
    if (!run || !active.includes(run.status)) return false;
    const [claimed] = await tx.update(agentExecutions).set({ status: "invoking", invokedAt: new Date() })
      .where(and(eq(agentExecutions.id, loaded.execution.id), eq(agentExecutions.status, "accepted"))).returning({ id: agentExecutions.id });
    return Boolean(claimed);
  });
}

/** Await each append; cursor+chunk commit in one transaction under the active Run fence. */
export async function appendNativeExecutionChunk(loaded: LoadedNativeExecution, chunk: UIMessageChunk): Promise<void> {
  await withRuntimeLease(loaded.lease, async tx => {
    const [run] = await tx.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.id, loaded.run.id), eq(agentRuns.fence, loaded.lease.fence)));
    if (!run) throw new HTTPException(409, { message: "运行已被接管" });
    const [execution] = await tx.update(agentExecutions).set({ lastCursor: sql`${agentExecutions.lastCursor}+1` })
      .where(and(eq(agentExecutions.id, loaded.execution.id), eq(agentExecutions.fence, loaded.lease.fence), eq(agentExecutions.status, "invoking")))
      .returning({ cursor: agentExecutions.lastCursor });
    if (!execution) throw new HTTPException(409, { message: "执行输出已关闭" });
    await tx.insert(agentExecutionChunks).values({ executionId: loaded.execution.id, cursor: execution.cursor, chunk: chunk as unknown as Record<string, unknown> });
  });
}

/** Settled describes this computing attempt; authoritative business outcome remains agent_runs. */
export async function settleNativeExecution(executionId: string, error?: string): Promise<void> {
  await getDatabase().update(agentExecutions).set({ status: "settled", settledAt: new Date(), error: error ?? null })
    .where(and(eq(agentExecutions.id, executionId), eq(agentExecutions.status, "invoking")));
}

export async function readNativeExecutionOutput(input: { executionId: string; actor: Actor; expected?: NativeExecutionReference; after?: number; limit?: number }) {
  uuid.parse(input.executionId);
  if (input.expected) {
    uuid.parse(input.expected.runId);uuid.parse(input.expected.threadId);
    if (input.expected.executionId !== input.executionId) throw new HTTPException(404, { message: "执行不存在" });
  }
  const after = z.number().int().min(0).max(2_147_483_647).parse(input.after ?? 0);
  const limit = z.number().int().min(1).max(500).parse(input.limit ?? 100);
  return getDatabase().transaction(async tx => {
    const [membership] = await tx.select({ id: member.id }).from(member).where(and(eq(member.userId, input.actor.userId), eq(member.organizationId, input.actor.organizationId))).for("share");
    const [row] = await tx.select({ execution: agentExecutions, runStatus: agentRuns.status, threadId: chatThreads.id }).from(agentExecutions)
      .innerJoin(agentRuns, eq(agentRuns.id, agentExecutions.runId)).innerJoin(chatThreads, eq(chatThreads.id, agentRuns.threadId))
      .where(and(eq(agentExecutions.id, input.executionId), eq(chatThreads.userId, input.actor.userId), eq(chatThreads.organizationId, input.actor.organizationId)));
    if (!membership || !row || input.expected && (row.execution.runId !== input.expected.runId || row.threadId !== input.expected.threadId))
      throw new HTTPException(404, { message: "执行不存在" });
    const events = await tx.select({ cursor: agentExecutionChunks.cursor, chunk: agentExecutionChunks.chunk }).from(agentExecutionChunks)
      .where(and(eq(agentExecutionChunks.executionId, input.executionId), sql`${agentExecutionChunks.cursor}>${after}`)).orderBy(asc(agentExecutionChunks.cursor)).limit(limit);
    return { events: events as { cursor: number; chunk: UIMessageChunk }[], status: row.execution.status,
      // A settled event page is terminal only after its final committed chunk is drained.
      terminal: row.execution.status === "settled" && (events.at(-1)?.cursor ?? after) >= row.execution.lastCursor,
      runStatus: row.runStatus };
  });
}
