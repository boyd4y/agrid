import { z } from "zod";
import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { AUTOMATION_UPDATE_SCHEMA, scheduledOccurrenceQuerySchema, type ScheduledOccurrence, type AutomationRule } from "@tabdo/shared";
import type { CommandDependencies } from "../dependencies.js";
import type { Transaction } from "../db/types.js";
import type { CalendarCaller } from "./service.js";
import { automations, automationSchedules, automationOccurrences, automationRuns, automationAgentActions, automationEvents, chatThreads, member } from "../db/schema.js";
import { resolveSiteKey } from "../data-api/keys.js";
import { requireWorkspace } from "../tenant/workspace.js";
import { schedulePreview } from "../automation/schedule.js";
import { updateAutomation } from "../automation/crud.js";
import { CalendarError } from "./errors.js";

/** Bounded read projection. Neither cron nor predicted points are copied into bookings/occurrences. */
export async function queryScheduledOccurrences(deps: CommandDependencies, caller: CalendarCaller, raw: unknown, transaction?: Transaction) {
  const parsed = scheduledOccurrenceQuerySchema.safeParse(raw);
  if (!parsed.success) throw new CalendarError(400, "BAD_INPUT", parsed.error.issues[0]?.message ?? "Invalid schedule query");
  const input = parsed.data;
  const work = async (tx: Transaction) => {
    let organizationId: string, ids = input.automationIds, workspaceId: string | undefined, viewer: string | undefined;
    if (caller.kind === "key") {
      const principal = await resolveSiteKey(tx, caller.secret, true); organizationId = principal.organizationId;
      if (!ids?.length) throw new CalendarError(400, "BAD_INPUT", "API keys must select scheduled automationIds explicitly");
      if (ids.some(id => !principal.schedulePermissions?.get(id)?.canRead)) throw new CalendarError(403, "FORBIDDEN", "Schedule reading is not granted");
    } else {
      organizationId = caller.organizationId; viewer = caller.actorId;
      const [membership] = await tx.select({ id: member.id }).from(member).where(and(eq(member.organizationId, organizationId), eq(member.userId, viewer))).for("share");
      if (!membership) throw new CalendarError(403, "FORBIDDEN", "Current membership is required");
      workspaceId = (await requireWorkspace(deps, organizationId, tx)).id;
    }
    const rules = await tx.select({ rule: automations, schedule: automationSchedules }).from(automations)
      .leftJoin(automationSchedules, eq(automationSchedules.automationId, automations.id))
      .where(and(eq(automations.organizationId, organizationId), isNull(automations.deletedAt), sql`${automations.source}->>'kind' = 'schedule'`,
        workspaceId ? eq(automations.workspaceId, workspaceId) : undefined, ids ? inArray(automations.id, ids) : undefined)).orderBy(asc(automations.id)).limit(101);
    if (rules.length > 100) throw new CalendarError(400, "QUERY_LIMIT", "Select at most 100 scheduled rules");
    if (ids && rules.length !== new Set(ids).size) throw new CalendarError(404, "NOT_FOUND", "Scheduled rule not found");
    if (caller.kind === "key" && new Set(rules.map(v => v.rule.workspaceId)).size > 1) throw new CalendarError(400, "BAD_INPUT", "Query one workspace at a time");
    const items: ScheduledOccurrence[] = [];
    const append = (item: ScheduledOccurrence) => { if (items.length >= input.limit) throw new CalendarError(400, "QUERY_LIMIT", "Schedule projection exceeds limit; reduce range or select fewer rules"); items.push(item); };
    const rangeStart = new Date(input.rangeStart), rangeEnd = new Date(input.rangeEnd), now = deps.now();
    for (const { rule, schedule } of rules) {
      if (rule.source.kind !== "schedule") continue;
      const source = rule.source;
      const base = { automationId: rule.id, ruleVersion: rule.version, name: rule.name, enabled: rule.enabled, cron: source.cron, timeZone: source.timeZone };
      const occurred = await tx.select({ occurrence: automationOccurrences, run: automationRuns, thread: chatThreads, event: automationEvents }).from(automationOccurrences)
        .leftJoin(automationEvents, eq(automationEvents.id, automationOccurrences.eventId))
        .leftJoin(automationRuns, and(eq(automationRuns.eventId, automationOccurrences.eventId), eq(automationRuns.automationId, rule.id)))
        .leftJoin(automationAgentActions, and(eq(automationAgentActions.runId, automationRuns.id), eq(automationAgentActions.step, 0)))
        .leftJoin(chatThreads, eq(chatThreads.id, automationAgentActions.threadId))
        .where(and(eq(automationOccurrences.automationId, rule.id), gte(automationOccurrences.scheduledFor, rangeStart), lt(automationOccurrences.scheduledFor, rangeEnd)))
        .orderBy(asc(automationOccurrences.scheduledFor)).limit(input.limit + 1);
      for (const { occurrence, run, thread, event } of occurred) {
        const saved = run?.ruleSnapshot as unknown as AutomationRule | undefined;
        const savedSource = saved?.source.kind === "schedule" ? saved.source : source;
        append({ ...base, name: saved?.name ?? base.name, ruleVersion: occurrence.ruleVersion, cron: savedSource.cron, timeZone: savedSource.timeZone,
          scheduledFor: occurrence.scheduledFor.toISOString(), projection: "occurred", status: run?.status ?? "unknown",
          delayed: (event?.snapshot as { event?: { data?: { delayed?: boolean } } } | undefined)?.event?.data?.delayed === true,
          threadId: viewer && thread?.userId === viewer && thread.workspaceId === rule.workspaceId ? thread.id : null });
      }
      if (!rule.enabled || !schedule || schedule.ruleVersion !== rule.version) continue;
      if (schedule.nextRunAt < now && schedule.nextRunAt >= rangeStart && schedule.nextRunAt < rangeEnd)
        append({ ...base, scheduledFor: schedule.nextRunAt.toISOString(), projection: "planned", delayed: true, status: null, threadId: null });
      const start = Math.max(+rangeStart, +now, +schedule.nextRunAt);
      if (start >= +rangeEnd) continue;
      // At most limit+1 candidates per rule, at most 100 rules. Overflow is explicit.
      for (const scheduledFor of schedulePreview(source.cron, source.timeZone, new Date(start - 1), input.limit + 1)) {
        if (Date.parse(scheduledFor) >= +rangeEnd) break;
        append({ ...base, scheduledFor, projection: "planned", delayed: false, status: null, threadId: null });
      }
    }
    items.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || a.automationId.localeCompare(b.automationId));
    return { items, complete: true as const, limit: input.limit };
  };
  return transaction ? transaction.transaction(work) : deps.database.transaction(work);
}

/** Key grants authorize only explicitly selected schedule rules, never all calendar automations. */
export async function updateScheduledAutomation(deps: CommandDependencies, secret: string, raw: unknown) {
  const schema = AUTOMATION_UPDATE_SCHEMA.extend({ automationId: z.uuid() });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new CalendarError(400, "BAD_INPUT", "Invalid scheduled rule update");
  if (!parsed.data.expectedVersion) throw new CalendarError(400, "BAD_INPUT", "expectedVersion is required");
  return deps.database.transaction(async tx => {
    const principal = await resolveSiteKey(tx, secret, true);
    if (!principal.schedulePermissions?.get(parsed.data.automationId)?.canUpdate) throw new CalendarError(403, "FORBIDDEN", "Schedule update is not granted");
    const [rule] = await tx.select().from(automations).where(and(eq(automations.id, parsed.data.automationId), eq(automations.organizationId, principal.organizationId), isNull(automations.deletedAt))).for("update");
    if (!rule || rule.source.kind !== "schedule") throw new CalendarError(404, "NOT_FOUND", "Scheduled rule not found");
    if (!principal.userId) throw new CalendarError(403, "FORBIDDEN", "A current key owner is required");
    const [owner] = await tx.select({ id: member.id }).from(member).where(and(eq(member.userId, principal.userId), eq(member.organizationId, principal.organizationId))).for("share");
    if (!owner) throw new CalendarError(403, "FORBIDDEN", "Key owner is no longer a member");
    // A schedule grant can edit its timing/name/enabled state; it cannot grant arbitrary agent/data actions.
    if (parsed.data.actions || parsed.data.trigger || parsed.data.conditions || parsed.data.eventConditions || parsed.data.conditionLogic)
      throw new CalendarError(403, "FORBIDDEN", "Schedule grants only allow timing, name and enabled changes");
    const result = await updateAutomation({ ...deps, workspaceId: rule.workspaceId }, { ...parsed.data, organizationId: principal.organizationId, actorId: principal.userId }, tx);
    return { automationId: result.id, version: result.version, enabled: result.enabled, name: result.name, source: result.source };
  });
}
