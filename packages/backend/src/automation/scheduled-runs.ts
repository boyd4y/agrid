import { and, desc, eq, sql } from "drizzle-orm";
import type { Actor } from "../auth/actor.js";
import type { RuntimeDependencies } from "../dependencies.js";

import { automations, automationRuns, automationAgentActions, chatThreads } from "../db/schema.js";
import { requireThread } from "../chat/store.js";
import { ServiceError } from "../errors.js";

export async function listScheduledRuns(deps: RuntimeDependencies, taskId: string, actor: Actor, offset = 0, limit = 20) {
  const [task] = await deps.database.select({ source: automations.source }).from(automations)
    .where(and(eq(automations.id, taskId), eq(automations.organizationId, actor.organizationId)));
  if (task?.source.kind !== "schedule") throw new ServiceError(404, { message: "定时任务不存在" });
  const items = await deps.database.select({
    id: automationRuns.id, automationId: automationRuns.automationId, status: automationRuns.status,
    createdAt: automationRuns.createdAt, finishedAt: automationRuns.finishedAt, error: automationRuns.error,
    threadId: chatThreads.id, title: chatThreads.title,
    prompt: sql<string>`coalesce(${automationRuns.ruleSnapshot}->'actions'->0->>'prompt','')`,
    preview: sql<string | null>`(SELECT left(string_agg(part->>'text', E'\n'),1200)
      FROM chat_messages m CROSS JOIN LATERAL jsonb_array_elements(m.content->'parts') part
      WHERE m.thread_id=${chatThreads.id} AND m.content->>'role'='assistant' AND part->>'type'='text'
      GROUP BY m.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1)`,
    nativeStatus: sql<string | null>`(SELECT status FROM agent_runs WHERE thread_id=${chatThreads.id} ORDER BY started_at DESC,id DESC LIMIT 1)`,
  }).from(automationRuns).innerJoin(automations, eq(automations.id, automationRuns.automationId))
    .leftJoin(automationAgentActions, and(eq(automationAgentActions.runId, automationRuns.id), eq(automationAgentActions.step, 0)))
    .leftJoin(chatThreads, and(eq(chatThreads.id, automationAgentActions.threadId), eq(chatThreads.kind, "scheduled_task"), eq(chatThreads.userId, actor.userId), eq(chatThreads.scheduledTaskId, taskId)))
    .where(and(eq(automationRuns.automationId, taskId), eq(automations.organizationId, actor.organizationId), eq(automations.createdByUserId, actor.userId)))
    .orderBy(desc(automationRuns.createdAt), desc(automationRuns.id)).limit(limit + 1).offset(offset);
  return { runs: items.slice(0, limit), hasMore: items.length > limit };
}

export async function getScheduledRunThread(deps: RuntimeDependencies, taskId: string, threadId: string, actor: Actor) {
  const thread = await requireThread(deps, threadId, actor);
  if (thread.kind !== "scheduled_task" || thread.scheduledTaskId !== taskId) throw new ServiceError(404, { message: "定时任务运行不存在" });
  return { id: thread.id, kind: thread.kind, scheduledTaskId: thread.scheduledTaskId, custom: thread.custom, title: thread.title };
}
