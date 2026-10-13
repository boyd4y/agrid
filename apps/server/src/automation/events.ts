import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { applyFilters, triggerMatches, type AutomationEvent, type AutomationRule, type ColumnDef, type RowData } from "@tabdo/shared";
import type { Transaction } from "../db/index.js";
import { automations, automationEvents, automationRuns, automationOutbox } from "../db/schema.js";
import { queueName } from "../queue/config.js";

export type EventSnapshot = {
  protocol: 1;
  event: AutomationEvent;
  row: RowData;
  columns: ColumnDef[];
  actorId: string | null;
  traceId: string;
};

/** Fast matching inside the business transaction; persist only matched plans. */
export async function appendAutomationEvent(tx: Transaction, organizationId: string, event: AutomationEvent,
  row: RowData, columns: ColumnDef[], actorId?: string) {
  const rules = await tx.select().from(automations).where(and(
    eq(automations.tableId, event.tableId), eq(automations.enabled, true), isNull(automations.deletedAt)));
  const matched = rules.filter((raw) => {
    const rule = raw as unknown as AutomationRule;
    return triggerMatches(rule.trigger, event) && (!rule.conditions.length ||
      applyFilters([row], columns, { filters: rule.conditions, filterLogic: rule.conditionLogic }).length > 0);
  });
  if (!matched.length) return;
  const id = randomUUID();
  const snapshot: EventSnapshot = { protocol: 1, event, row, columns, actorId: actorId ?? null, traceId: id };
  await tx.insert(automationEvents).values({ id, organizationId, tableId: event.tableId,
    rowId: event.rowId, rowVersion: row.version ?? 1, expectedVersion: row.version ?? 1,
    status: "matched", snapshot: snapshot as unknown as Record<string, unknown> });
  await tx.insert(automationRuns).values(matched.map((rule) => ({ automationId: rule.id,
    tableId: event.tableId, rowId: event.rowId, eventId: id, ruleVersion: rule.version,
    ruleSnapshot: rule as unknown as Record<string, unknown>, status: "queued",
    triggerType: (rule.trigger as AutomationRule["trigger"]).type,
    detail: { eventType: event.type, traceId: id },
  })));
  await tx.insert(automationOutbox).values({ eventId: id, queue: queueName,
    payload: { protocol: 1, eventId: id, generation: 0 } });
}
