import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Actor } from "../auth/actor.js";
import type { RuntimeDependencies } from "../dependencies.js";
import { chatThreads, agentThreadLeases, agentRuntimeSessions, agentRuns } from "../db/schema.js";
import { resolveChatContext } from "../chat/context.js";
import { agentExecutions } from "../db/execution-schema.js";
import { getReport } from "../reports/service.js";
import { requireThread, threadScope } from "../chat/store.js";
import { ServiceError } from "../errors.js";

const dto = (thread: typeof chatThreads.$inferSelect) => ({
  id: thread.id, kind: thread.kind, scheduledTaskId: thread.scheduledTaskId, title: thread.title, status: thread.status, custom: thread.custom,
  lastMessageAt: thread.lastMessageAt, updatedAt: thread.updatedAt,
});
export async function listThreads(deps: RuntimeDependencies, actor: Actor, after?: string) {
  let cursor: typeof chatThreads.$inferSelect | undefined;
  if (after) {
    cursor = await requireThread(deps, z.uuid().parse(after), actor);
    if (cursor.kind !== "chat") throw new ServiceError(400, { message: "分页游标不属于普通对话" });
  }
  const threads = await deps.database.select().from(chatThreads).where(and(
    eq(chatThreads.userId, actor.userId), eq(chatThreads.organizationId, actor.organizationId), eq(chatThreads.kind, "chat"),
    cursor ? or(lt(chatThreads.createdAt, cursor.createdAt), and(eq(chatThreads.createdAt, cursor.createdAt), lt(chatThreads.id, cursor.id))) : undefined,
  )).orderBy(desc(chatThreads.createdAt), desc(chatThreads.id)).limit(101);
  return { threads: threads.slice(0, 100).map(dto), nextCursor: threads.length > 100 ? threads[99].id : undefined };
}
export async function createThread(deps: RuntimeDependencies, actor: Actor, raw: unknown) {
  const input = z.object({ clientId: z.string().min(1).max(200), context: z.unknown(), agentId: z.string().nullable().optional() }).parse(raw);
  const { resourceKey, context } = await resolveChatContext({ ...deps, loadReport: (id, org) => getReport(deps, id, org) }, input.context, actor);
  if (context.scheduledTaskId) throw new ServiceError(400, { message: "定时任务会话由运行创建，请打开已有运行" });
  const [thread] = await deps.database.insert(chatThreads).values({ userId: actor.userId, organizationId: actor.organizationId, clientId: input.clientId, custom: { resourceKey, agentId: input.agentId ?? null } })
    .onConflictDoUpdate({ target: [chatThreads.userId, chatThreads.organizationId, chatThreads.clientId], set: { clientId: input.clientId } }).returning();
  if (thread.kind !== "chat") throw new ServiceError(409, { message: "不能将任务运行变成普通对话" });
  if (thread.custom.resourceKey !== resourceKey) throw new ServiceError(409, { message: "对话属于其他资源" });
  return dto(thread);
}
export async function getThread(deps: RuntimeDependencies, actor: Actor, id: string) {
  return dto(await requireThread(deps, z.uuid().parse(id), actor));
}
export async function updateThread(deps: RuntimeDependencies, actor: Actor, threadId: string, raw: unknown) {
  const thread = await requireThread(deps, z.uuid().parse(threadId), actor);
  const input = z.object({ title: z.string().trim().min(1).max(200).optional(), custom: z.record(z.string(), z.unknown()).optional() }).strict().parse(raw);
  if (typeof thread.custom.agentId === "string" && input.custom && Object.hasOwn(input.custom, "agentId") && input.custom.agentId !== thread.custom.agentId) throw new ServiceError(409, { message: "已有对话不能更换智能体" });
  if (input.custom?.resourceKey && input.custom.resourceKey !== thread.custom.resourceKey) throw new ServiceError(409, { message: "不能更换已有对话的资源绑定" });
  const [updated] = await deps.database.update(chatThreads).set({ ...input, custom: input.custom ? { ...thread.custom, ...input.custom, resourceKey: thread.custom.resourceKey } : thread.custom, updatedAt: deps.now() }).where(threadScope(threadId, actor)).returning();
  return dto(updated);
}
/** Returns cleanup handles; the deployment owns native resource destruction. */
export async function deleteThread(deps: RuntimeDependencies, actor: Actor, threadId: string) {
  await requireThread(deps, z.uuid().parse(threadId), actor);
  return deps.database.transaction(async tx => {
    await tx.insert(agentThreadLeases).values({ threadId, fence: 0 }).onConflictDoNothing();
    const [lease] = await tx.select({ live: sql<boolean>`${agentThreadLeases.token} is not null and ${agentThreadLeases.expiresAt} > clock_timestamp()` }).from(agentThreadLeases).where(eq(agentThreadLeases.threadId, threadId)).for("update");
    if (lease?.live) throw new ServiceError(409, { message: "请先停止当前执行，等待结果保存后再删除对话" });
    const records = await tx.select({ id: agentRuntimeSessions.id }).from(agentRuntimeSessions).where(eq(agentRuntimeSessions.threadId, threadId));
    const executions = await tx.select({ runtimeId: agentRuns.runtimeSessionId, executionId: agentExecutions.id })
      .from(agentRuns).innerJoin(agentExecutions, eq(agentExecutions.runId, agentRuns.id)).where(eq(agentRuns.threadId, threadId));
    // Capture private resource mappings before cascading deletion removes them.
    const cleanup = records.map(record => ({ runtimeId: record.id,
      executionIds: executions.filter(execution => execution.runtimeId === record.id).map(execution => execution.executionId),
    }));
    await tx.delete(chatThreads).where(threadScope(threadId, actor));
    return cleanup;
  });
}
export async function setThreadTitle(deps: RuntimeDependencies, actor: Actor, threadId: string, raw: unknown) {
  const { title } = z.object({ title: z.string().trim().min(1).max(200) }).parse(raw);
  await requireThread(deps, z.uuid().parse(threadId), actor);
  await deps.database.update(chatThreads).set({ title, updatedAt: deps.now() }).where(and(threadScope(threadId, actor), isNull(chatThreads.title)));
  return { title: (await requireThread(deps, threadId, actor)).title };
}
