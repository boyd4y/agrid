import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { resolveActor, type Actor } from "../auth/actor.js";
import { db } from "../db/index.js";
import { chatThreads, agentThreadLeases, agentRuntimeSessions } from "../db/schema.js";
import { resolveChatContext } from "../chat/context.js";
import { loadMessages, requireThread, threadScope } from "../chat/store.js";
import { listNativeRuns, listNativeRunEvents, requestRunCancellation } from "../harness/runs.js";
import { getThreadTaskState } from "../harness/tasks.js";
import { discardQuestionSandbox } from "../harness/question-sandboxes.js";

export const threadsRoute = new Hono<{ Variables: { actor: Actor } }>();
threadsRoute.use("*", async (c, next) => {
  const actor = await resolveActor(c.req.raw);
  if (!actor?.organizationId) return c.json({ error: "未授权" }, 401);
  c.set("actor", actor);
  await next();
});
const id = (value: string) => z.uuid().parse(value);
const dto = (thread: typeof chatThreads.$inferSelect) => ({
  id: thread.id, title: thread.title, status: thread.status, custom: thread.custom,
  lastMessageAt: thread.lastMessageAt, updatedAt: thread.updatedAt,
});

threadsRoute.get("/", async (c) => {
  const actor = c.get("actor");
  const after = c.req.query("after");
  let cursor: typeof chatThreads.$inferSelect | undefined;
  if (after) cursor = await requireThread(id(after), actor);
  const threads = await db.select().from(chatThreads).where(and(
    eq(chatThreads.userId, actor.userId), eq(chatThreads.organizationId, actor.organizationId),
    cursor ? or(lt(chatThreads.createdAt, cursor.createdAt), and(eq(chatThreads.createdAt, cursor.createdAt), lt(chatThreads.id, cursor.id))) : undefined,
  )).orderBy(desc(chatThreads.createdAt), desc(chatThreads.id)).limit(101);
  return c.json({ threads: threads.slice(0, 100).map(dto), nextCursor: threads.length > 100 ? threads[99].id : undefined });
});

threadsRoute.post("/", async (c) => {
  const input = z.object({ clientId: z.string().min(1).max(200), context: z.unknown(), agentId: z.string().nullable().optional() }).parse(await c.req.json());
  const actor = c.get("actor");
  const { resourceKey } = await resolveChatContext(input.context, actor);
  const [thread] = await db.insert(chatThreads).values({ userId: actor.userId, organizationId: actor.organizationId, clientId: input.clientId, custom: { resourceKey, agentId: input.agentId ?? null } })
    .onConflictDoUpdate({ target: [chatThreads.userId, chatThreads.organizationId, chatThreads.clientId], set: { clientId: input.clientId } }).returning();
  if (thread.custom.resourceKey !== resourceKey) throw new HTTPException(409, { message: "对话属于其他资源" });
  return c.json(dto(thread), 201);
});

threadsRoute.get("/:id", async (c) => c.json(dto(await requireThread(id(c.req.param("id")), c.get("actor")))));
threadsRoute.patch("/:id", async (c) => {
  const actor = c.get("actor"), threadId = id(c.req.param("id"));
  const thread = await requireThread(threadId, actor);
  const input = z.object({ title: z.string().trim().min(1).max(200).optional(), custom: z.record(z.string(), z.unknown()).optional() }).strict().parse(await c.req.json());
  if (input.custom?.resourceKey && input.custom.resourceKey !== thread.custom.resourceKey) throw new HTTPException(409, { message: "不能更换已有对话的资源绑定" });
  const [updated] = await db.update(chatThreads).set({ ...input, custom: input.custom ? { ...thread.custom, ...input.custom, resourceKey: thread.custom.resourceKey } : thread.custom, updatedAt: new Date() }).where(threadScope(threadId, actor)).returning();
  return c.json(dto(updated));
});
threadsRoute.delete("/:id", async (c) => {
  const threadId = id(c.req.param("id")), actor = c.get("actor");
  await requireThread(threadId, actor);
  const runtimeIds = await db.transaction(async (tx) => {
    // Serialize deletion with claims and tool commits, including a thread that
    // has not acquired its first lease yet. A running owner must stop first.
    await tx.insert(agentThreadLeases).values({ threadId, fence: 0 }).onConflictDoNothing();
    const [lease] = await tx.select({ live: sql<boolean>`${agentThreadLeases.token} is not null and ${agentThreadLeases.expiresAt} > clock_timestamp()` }).from(agentThreadLeases).where(eq(agentThreadLeases.threadId, threadId)).for("update");
    if (lease?.live) throw new HTTPException(409, { message: "请先停止当前执行，等待结果保存后再删除对话" });
    const records = await tx.select({ id: agentRuntimeSessions.id }).from(agentRuntimeSessions).where(eq(agentRuntimeSessions.threadId, threadId));
    await tx.delete(chatThreads).where(threadScope(threadId, actor));
    return records.map((record) => record.id);
  });
  await Promise.all(runtimeIds.map((runtimeId) => discardQuestionSandbox(runtimeId).catch((error: unknown) => console.error("agent.question.discard", error instanceof Error ? error.message : "Resource cleanup failed"))));
  return c.json({ ok: true });
});
threadsRoute.post("/:id/title", async (c) => {
  const actor = c.get("actor"), threadId = id(c.req.param("id"));
  const { title } = z.object({ title: z.string().trim().min(1).max(200) }).parse(await c.req.json());
  await requireThread(threadId, actor);
  await db.update(chatThreads).set({ title, updatedAt: new Date() }).where(and(threadScope(threadId, actor), isNull(chatThreads.title)));
  return c.json({ title: (await requireThread(threadId, actor)).title });
});

threadsRoute.get("/:id/messages", async (c) => c.json(await loadMessages(id(c.req.param("id")), c.get("actor"))));
threadsRoute.get("/:id/runs", async (c) => c.json({ runs: await listNativeRuns(id(c.req.param("id")), c.get("actor")) }));
threadsRoute.get("/:id/task-state", async (c) => c.json({ state: await getThreadTaskState(id(c.req.param("id")), c.get("actor")) }));
threadsRoute.get("/:id/runs/:runId/events", async (c) => c.json({ events: await listNativeRunEvents(id(c.req.param("id")), id(c.req.param("runId")), c.get("actor")) }));
threadsRoute.post("/:id/runs/:runId/cancel", async (c) => c.json(await requestRunCancellation(id(c.req.param("id")), id(c.req.param("runId")), c.get("actor"))));
threadsRoute.post("/:id/messages", async (c) => {
  // Compatibility for older history adapters: native chat alone commits input
  // and output. A client projection must not advance or overwrite native history.
  await requireThread(id(c.req.param("id")), c.get("actor"));
  return c.json({ ok: true });
});
