import type { CommandDependencies } from "../dependencies.js";
import { and, eq, isNull, lte } from "drizzle-orm";

import type { AutomationRule } from "@tabdo/shared";

import { type Transaction } from "../db/context.js";
import { automations, automationSchedules, automationOccurrences } from "../db/schema.js";
import { appendExternalAutomationEvent } from "./events.js";

import { schedulePreview } from "@tabdo/core/tasks/schedule";
export { schedulePreview } from "@tabdo/core/tasks/schedule";

export async function syncSchedule(deps: CommandDependencies, tx: Transaction, rule: AutomationRule, now = deps.now()) {
  if (rule.source.kind !== "schedule" || !rule.enabled) {
    await tx.delete(automationSchedules).where(eq(automationSchedules.automationId, rule.id));
    return;
  }
  const nextRunAt = new Date(schedulePreview(rule.source.cron, rule.source.timeZone, now, 1)[0]);
  await tx.insert(automationSchedules).values({ automationId: rule.id, ruleVersion: rule.version, nextRunAt }).onConflictDoUpdate({
    target: automationSchedules.automationId, set: { ruleVersion: rule.version, nextRunAt },
  });
}
/** SQL is the scheduling authority; no process or browser clock owns a job. */
export async function dispatchDueSchedules(deps: CommandDependencies, now = deps.now(), limit = 25, organizationId?: string) {
  return deps.database.transaction(async tx => {
    const due = await tx.select({ schedule: automationSchedules, rule: automations }).from(automationSchedules)
      .innerJoin(automations, eq(automations.id, automationSchedules.automationId))
      .where(and(lte(automationSchedules.nextRunAt, now), eq(automations.enabled, true), isNull(automations.deletedAt), ...(organizationId ? [eq(automations.organizationId, organizationId)] : [])))
      .orderBy(automationSchedules.nextRunAt).limit(limit).for("update", { of: automations, skipLocked: true });
    let sent = 0;
    for (const { schedule, rule: raw } of due) {
      const rule = raw as unknown as AutomationRule;
      if (rule.source.kind !== "schedule" || rule.version !== schedule.ruleVersion) { await syncSchedule(deps, tx, rule, now); continue; }
      const eventId = deps.uuid();
      const [occurrence] = await tx.insert(automationOccurrences).values({ automationId: rule.id, ruleVersion: rule.version,
        scheduledFor: schedule.nextRunAt, eventId }).onConflictDoNothing().returning();
      if (occurrence) {
        await appendExternalAutomationEvent(deps, tx, { id: eventId, organizationId: rule.organizationId, source: rule.source,
          type: "schedule_due", occurredAt: schedule.nextRunAt.toISOString(),
          data: { scheduledFor: schedule.nextRunAt.toISOString(), dispatchedAt: now.toISOString(), timeZone: rule.source.timeZone,
            delayed: now.getTime() - schedule.nextRunAt.getTime() > 60_000 }, traceId: eventId }, [rule]);
        sent++;
      }
      // Downtime is coalesced into one due occurrence rather than replaying every missed minute.
      const nextRunAt = new Date(schedulePreview(rule.source.cron, rule.source.timeZone, now, 1)[0]);
      await tx.update(automationSchedules).set({ nextRunAt }).where(and(eq(automationSchedules.automationId, rule.id), eq(automationSchedules.ruleVersion, schedule.ruleVersion)));
    }
    return sent;
  });
}
