import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { HarnessAgentResumeSessionState } from "@ai-sdk/harness/agent";
import type { Actor } from "../auth/actor.js";
import { getDatabase } from "@tabdo/backend/resources";
import { type Transaction } from "../db/context.js";
import {
  agentProfile,
  agentRuntimeSessions,
  agentThreadLeases,
  chatThreads,
  agentRuns,
} from "../db/schema.js";
import {
  requireThread,
  threadScope,
  saveMessageInTransaction,
  type StoredMessage,
} from "../chat/store.js";
import {
  workspaceSnapshotSchema,
  type WorkspaceSnapshot,
} from "@tabdo/backend/checkpoints";

export type RuntimeLease = { threadId: string; token: string; fence: number };
export type RuntimeRecord = typeof agentRuntimeSessions.$inferSelect;
/** Only server-final messages may certify that an accepted input never entered Pi. */
export const NOT_INVOKED = "pi-not-invoked-v1";
const leaseScope = (lease: RuntimeLease) =>
  and(
    eq(agentThreadLeases.threadId, lease.threadId),
    eq(agentThreadLeases.token, lease.token),
    eq(agentThreadLeases.fence, lease.fence),
  );

export async function claimRuntimeLease(
  threadId: string,
  actor: Actor,
): Promise<RuntimeLease> {
  await requireThread(threadId, actor);
  const token = randomUUID();
  // One conditional UPSERT is the claim; two workers cannot both observe idle.
  const result = await getDatabase().execute(sql`
    INSERT INTO agent_thread_leases (thread_id,token,fence,expires_at)
    VALUES (${threadId}::uuid,${token}::uuid,1,clock_timestamp()+interval '120 seconds')
    ON CONFLICT (thread_id) DO UPDATE SET token=EXCLUDED.token,
      fence=agent_thread_leases.fence+1,expires_at=clock_timestamp()+interval '120 seconds'
    WHERE agent_thread_leases.token IS NULL OR agent_thread_leases.expires_at < clock_timestamp()
    RETURNING fence
  `);
  if (!result[0])
    throw new HTTPException(409, {
      message: "这个对话正在运行，请等待完成或停止后再发送",
    });
  return { threadId, token, fence: Number(result[0].fence) };
}

export async function renewRuntimeLease(lease: RuntimeLease): Promise<boolean> {
  const rows = await getDatabase()
    .update(agentThreadLeases)
    .set({ expiresAt: sql`clock_timestamp()+interval '120 seconds'` })
    .where(
      and(
        leaseScope(lease),
        sql`${agentThreadLeases.expiresAt} > clock_timestamp()`,
      ),
    )
    .returning({ token: agentThreadLeases.token });
  return rows.length === 1;
}

export async function releaseRuntimeLease(lease: RuntimeLease): Promise<void> {
  await getDatabase()
    .update(agentThreadLeases)
    .set({ token: null, expiresAt: null })
    .where(leaseScope(lease));
}

/** The row lock covers the operation, so expiry cannot let another worker
 * steal the lease between checking ownership and executing a host mutation. */
export async function withRuntimeLease<T>(
  lease: RuntimeLease,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return getDatabase().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(agentThreadLeases)
      .where(
        and(
          leaseScope(lease),
          sql`${agentThreadLeases.expiresAt} > clock_timestamp()`,
        ),
      )
      .for("update");
    if (!row)
      throw new HTTPException(409, {
        message: "智能体运行已被其他实例接管，请刷新对话",
      });
    await tx
      .update(agentThreadLeases)
      .set({ expiresAt: sql`clock_timestamp()+interval '120 seconds'` })
      .where(leaseScope(lease));
    return fn(tx);
  });
}

export async function prepareRuntimeRecord(
  lease: RuntimeLease,
  actor: Actor,
  options: { profileId: string; harness: string; mode: "local" | "sandbox" },
): Promise<RuntimeRecord> {
  return withRuntimeLease(lease, async (tx) => {
    const [thread] = await tx
      .select({ id: chatThreads.id })
      .from(chatThreads)
      .where(threadScope(lease.threadId, actor));
    const [profile] = await tx
      .select({ id: agentProfile.id })
      .from(agentProfile)
      .where(
        and(
          eq(agentProfile.id, options.profileId),
          eq(agentProfile.organizationId, actor.organizationId),
        ),
      );
    if (!thread || !profile)
      throw new HTTPException(404, { message: "对话或智能体不存在" });
    await tx
      .insert(agentRuntimeSessions)
      .values({
        threadId: lease.threadId,
        agentProfileId: options.profileId,
        harness: options.harness,
        mode: options.mode,
        sandboxId: randomUUID(),
      })
      .onConflictDoNothing({
        target: [
          agentRuntimeSessions.threadId,
          agentRuntimeSessions.agentProfileId,
        ],
      });
    const [record] = await tx
      .select()
      .from(agentRuntimeSessions)
      .where(
        and(
          eq(agentRuntimeSessions.threadId, lease.threadId),
          eq(agentRuntimeSessions.agentProfileId, options.profileId),
        ),
      );
    if (record.harness !== options.harness || record.mode !== options.mode)
      throw new HTTPException(409, {
        message: "运行环境已变更，请新建对话使用新的环境",
      });
    return record;
  });
}

export type RuntimeCheckpoint = {
  resumeState: HarnessAgentResumeSessionState;
  workspace: WorkspaceSnapshot | null;
  sandboxId: string;
  userMessageId: string;
  assistantMessageId: string;
  status: RuntimeRecord["status"];
  error?: string;
};

async function writeCheckpoint(
  tx: Transaction,
  lease: RuntimeLease,
  recordId: string,
  checkpoint: RuntimeCheckpoint,
) {
  const updated = await tx
    .update(agentRuntimeSessions)
    .set({
      resumeState: checkpoint.resumeState,
      workspace: checkpoint.workspace,
      sandboxId: checkpoint.sandboxId,
      lastUserMessageId: checkpoint.userMessageId,
      lastAssistantMessageId: checkpoint.assistantMessageId,
      status: checkpoint.status,
      error: checkpoint.error ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentRuntimeSessions.id, recordId),
        eq(agentRuntimeSessions.threadId, lease.threadId),
      ),
    )
    .returning({ id: agentRuntimeSessions.id });
  if (!updated.length)
    throw new HTTPException(404, { message: "智能体会话不存在" });
}

export async function saveRuntimeCheckpoint(
  lease: RuntimeLease,
  recordId: string,
  checkpoint: RuntimeCheckpoint,
): Promise<void> {
  if (checkpoint.workspace != null)
    workspaceSnapshotSchema.parse(checkpoint.workspace);
  await withRuntimeLease(lease, async (tx) => {
    await writeCheckpoint(tx, lease, recordId, checkpoint);
  });
}

export async function completeRuntimeTurn(
  lease: RuntimeLease,
  actor: Actor,
  recordId: string,
  checkpoint: RuntimeCheckpoint,
  message: StoredMessage,
  run?: { id: string; status: import("@tabdo/shared").AgentRunStatus; error?: string },
): Promise<void> {
  if (
    message.id !== checkpoint.assistantMessageId ||
    message.parentId !== checkpoint.userMessageId
  )
    throw new HTTPException(400, { message: "运行记录与消息不一致" });
  if (checkpoint.workspace != null)
    workspaceSnapshotSchema.parse(checkpoint.workspace);
  await withRuntimeLease(lease, async (tx) => {
    await saveMessageInTransaction(tx, lease.threadId, actor, message, true);
    await writeCheckpoint(tx, lease, recordId, checkpoint);
    if (run) {
      const [saved] = await tx.update(agentRuns).set({ status: run.status, error: run.error ?? null, endedAt: new Date() })
        .where(and(eq(agentRuns.id, run.id), eq(agentRuns.threadId, lease.threadId), eq(agentRuns.fence, lease.fence))).returning({ id: agentRuns.id });
      if (!saved) throw new HTTPException(409, { message: "运行已被接管，无法提交结果" });
    }
  });
}

/** Commit a transport-only failure without replacing the native journal or opaque state.
 * Callers must know they have not called stream/continueStream, including synchronously. */
export async function completeUninvokedPiRun(
  lease: RuntimeLease, actor: Actor, recordId: string,
  message: StoredMessage, run: { id: string; status: "failed" | "cancelled"; error: string },
): Promise<void> {
  await withRuntimeLease(lease, async (tx) => {
    const [owned] = await tx.select().from(agentRuns).where(and(
      eq(agentRuns.id, run.id), eq(agentRuns.threadId, lease.threadId),
      eq(agentRuns.runtimeSessionId, recordId), eq(agentRuns.fence, lease.fence),
    )).for("update");
    const [record] = await tx.select().from(agentRuntimeSessions).where(and(
      eq(agentRuntimeSessions.id, recordId), eq(agentRuntimeSessions.threadId, lease.threadId),
    )).for("update");
    if (!owned || !record || record.harness !== "pi" || !["starting", "running"].includes(owned.status)
      || owned.assistantMessageId !== message.id || owned.userMessageId !== message.parentId)
      throw new HTTPException(409, { message: "无法提交尚未执行的运行结果" });
    await saveMessageInTransaction(tx, lease.threadId, actor, {
      ...message, content: { ...message.content, metadata: { runId: run.id, nativeInvocation: NOT_INVOKED } },
    }, true);
    // These are UI submission boundaries; a rejected input is never appended to native history.
    await tx.update(agentRuntimeSessions).set({
      lastUserMessageId: owned.userMessageId, lastAssistantMessageId: owned.assistantMessageId,
      status: run.status === "cancelled" ? "interrupted" : "failed", error: run.error, updatedAt: new Date(),
    }).where(eq(agentRuntimeSessions.id, recordId));
    await tx.update(agentRuns).set({ status: run.status, error: run.error, endedAt: new Date() }).where(eq(agentRuns.id, run.id));
  });
}
