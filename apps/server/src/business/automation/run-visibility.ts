import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseDependencies } from "../dependencies.js";
import type { Transaction } from "../db/types.js";
import { agentRuns, automationAgentActions, automationRuns, chatThreads } from "../db/schema.js";
import { workspaceScope } from "../tenant/workspace.js";

type Run = typeof automationRuns.$inferSelect;
export type RunHistory = { run: Run; actions: unknown; source: unknown };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const hasAgentAction = (value: unknown) => Array.isArray(value) && value.some(action => object(action).type === "run_agent");

/** Whole-result visibility: later data actions/errors may contain private agent output too.
 * The actual saved threads own accepted turns, independently of the rule's current creator.
 * A missing viewer, deleted thread or unresolved legacy reference never grants access.
 */
export async function readableRunDetails(deps: DatabaseDependencies, history: RunHistory[], organizationId: string, viewerId?: string, transaction?: Transaction) {
  const readable = new Set<string>();
  if (!history.length) return readable;
  const database = transaction ?? deps.database;
  const mappings = await database.select().from(automationAgentActions).where(inArray(automationAgentActions.runId, history.map(hit => hit.run.id)));
  const references = history.map(({ run, actions, source }) => {
    const saved = object(run.ruleSnapshot), savedActions = saved.actions;
    // Calendar rules are managed agent reminders. Empty/missing action history
    // cannot downgrade their results to public data on any reading surface.
    const managedReminder = object(source).kind === "calendar" || object(saved.source).kind === "calendar";
    const results = Array.isArray(run.detail.actions) ? run.detail.actions : [];
    const native = mappings.filter(mapping => mapping.runId === run.id);
    const threadIds = new Set(native.map(mapping => mapping.threadId));
    const agentRunIds = new Set(native.flatMap(mapping => mapping.agentRunId ? [mapping.agentRunId] : []));
    let unresolved = false;
    // These are platform result references, not an allowlist of fields to redact.
    for (const value of [run.detail, ...results]) {
      // Mail thread IDs belong to the provider, not private native chat threads.
      if (value !== run.detail && ["send_email", "reply_email"].includes(String(object(value).type))) continue;
      for (const [field, ids] of [["threadId", threadIds], ["agentRunId", agentRunIds]] as const) {
        const id = object(value)[field];
        if (id == null) continue;
        if (z.uuid().safeParse(id).success) ids.add(id as string);
        else unresolved = true;
      }
    }
    return { run, threadIds, agentRunIds, unresolved, private: managedReminder || native.length > 0 || threadIds.size > 0 || agentRunIds.size > 0 || unresolved
      || hasAgentAction(savedActions ?? actions) || hasAgentAction(results) || run.detail.nativeStatus !== undefined };
  });
  const nativeIds = [...new Set(references.flatMap(ref => [...ref.agentRunIds]))];
  const nativeRuns = nativeIds.length ? await database.select({ id: agentRuns.id, threadId: agentRuns.threadId }).from(agentRuns).where(inArray(agentRuns.id, nativeIds)) : [];
  for (const ref of references) for (const id of ref.agentRunIds) {
    const native = nativeRuns.find(run => run.id === id);
    if (native) ref.threadIds.add(native.threadId);
    else ref.unresolved = true;
  }
  const threadIds = [...new Set(references.flatMap(ref => [...ref.threadIds]))];
  const threads = viewerId && threadIds.length ? await database.select({ id: chatThreads.id, workspaceId: chatThreads.workspaceId }).from(chatThreads)
    .where(and(inArray(chatThreads.id, threadIds), eq(chatThreads.userId, viewerId), eq(chatThreads.organizationId, organizationId), workspaceScope(deps, organizationId, chatThreads.workspaceId))) : [];
  const owned = new Map(threads.map(thread => [thread.id, thread.workspaceId]));
  for (const ref of references) {
    if (!ref.private || (viewerId && !ref.unresolved && ref.threadIds.size > 0 && [...ref.threadIds].every(id => owned.get(id) === ref.run.workspaceId))) readable.add(ref.run.id);
  }
  return readable;
}
