import { and, asc, desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getDatabase } from "@tabdo/platform/resources";
import { type Transaction } from "../db/context.js";
import { agentRuns, agentRuntimeSessions, chatMessages, chatThreads } from "../db/schema.js";
import type { Actor } from "../auth/actor.js";

export function threadScope(id: string, actor: Actor) {
  return and(
    eq(chatThreads.id, id),
    eq(chatThreads.userId, actor.userId),
    eq(chatThreads.organizationId, actor.organizationId),
  );
}

export async function requireThread(id: string, actor: Actor) {
  const [thread] = await getDatabase()
    .select()
    .from(chatThreads)
    .where(threadScope(id, actor));
  if (!thread) throw new HTTPException(404, { message: "对话不存在" });
  return thread;
}

export type StoredMessage = {
  id: string;
  parentId: string | null;
  format: string;
  content: Record<string, unknown>;
};

/** Also used by native checkpoints so UI history and runtime state commit together. */
export async function saveMessageInTransaction(
  tx: Transaction,
  threadId: string,
  actor: Actor,
  message: StoredMessage,
  serverFinal = false,
) {
  const [thread] = await tx
    .select()
    .from(chatThreads)
    .where(threadScope(threadId, actor))
    .for("update");
  if (!thread) throw new HTTPException(404, { message: "对话不存在" });
  if (message.id === message.parentId)
    throw new HTTPException(400, { message: "消息不能引用自身" });
  if (message.parentId) {
    const [parent] = await tx
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.threadId, threadId),
          eq(chatMessages.messageId, message.parentId),
        ),
      );
    if (!parent) throw new HTTPException(400, { message: "父消息不存在" });
  }
  const scope = and(
    eq(chatMessages.threadId, threadId),
    eq(chatMessages.messageId, message.id),
  );
  const [existing] = await tx.select().from(chatMessages).where(scope);
  if (existing) {
    if (existing.parentId !== message.parentId)
      throw new HTTPException(409, { message: "消息分支不能被更换" });
    if (!existing.serverFinal || serverFinal)
      await tx
        .update(chatMessages)
        .set({ content: message.content, serverFinal })
        .where(scope);
  } else {
    await tx
      .insert(chatMessages)
      .values({
        threadId,
        messageId: message.id,
        parentId: message.parentId,
        format: message.format,
        content: message.content,
        serverFinal,
      });
    await tx
      .update(chatThreads)
      .set({
        headId: message.id,
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(threadScope(threadId, actor));
  }
}

export async function saveMessage(
  threadId: string,
  actor: Actor,
  message: StoredMessage,
  serverFinal = false,
) {
  return getDatabase().transaction((tx) =>
    saveMessageInTransaction(tx, threadId, actor, message, serverFinal),
  );
}

export async function loadMessages(threadId: string, actor: Actor) {
  const thread = await requireThread(threadId, actor);
  const [latest] = await getDatabase().select({ run: agentRuns, session: agentRuntimeSessions }).from(agentRuns)
    .innerJoin(agentRuntimeSessions, eq(agentRuns.runtimeSessionId, agentRuntimeSessions.id))
    .where(eq(agentRuns.threadId, threadId)).orderBy(desc(agentRuns.startedAt), desc(agentRuns.id)).limit(1);
  const messages = await getDatabase()
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, threadId))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
  return {
    // Old client-side HTTP failures may have advanced the display head. The
    // accepted native input/result is authoritative; no journal or tools replay.
    headId: latest ? (["starting", "running"].includes(latest.run.status) ? latest.run.userMessageId : latest.session.lastAssistantMessageId) : thread.headId,
    messages: messages.map((m) => ({
      id: m.messageId,
      parentId: m.parentId,
      format: m.format,
      content: m.content,
    })),
  };
}
