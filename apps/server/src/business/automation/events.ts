import type { CommandDependencies } from "../dependencies.js";

import { and, eq, isNull } from "drizzle-orm";
import { automationPath, automationConditionsMatch, triggerMatches, type AutomationEvent, type AutomationRule, type ColumnDef, type RowData } from "@tabdo/shared";
import type { Transaction } from "../db/context.js";
import { automations, automationEvents, automationRuns, automationOutbox } from "../db/schema.js";

export type EventSnapshot = {
  protocol: 1;
  event: AutomationEvent;
  row: RowData;
  columns: ColumnDef[];
  actorId: string | null;
  traceId: string;
};

/** Fast matching inside the business transaction; persist only matched plans. */
export async function appendAutomationEvent(deps: CommandDependencies, tx: Transaction, organizationId: string, event: AutomationEvent,
  row: RowData, columns: ColumnDef[], actorId?: string) {
  const rules = await tx.select().from(automations).where(and(
    eq(automations.tableId, event.tableId), eq(automations.enabled, true), isNull(automations.deletedAt)));
  const matched = rules.filter((raw) => {
    const rule = raw as unknown as AutomationRule;
    return triggerMatches(rule.trigger, event) && automationConditionsMatch(row, columns, rule.conditions, rule.conditionLogic);
  });
  if (!matched.length) return;
  const id = deps.uuid();
  const snapshot: EventSnapshot = { protocol: 1, event, row, columns, actorId: actorId ?? null, traceId: id };
  await tx.insert(automationEvents).values({ id, organizationId, workspaceId: matched[0].workspaceId, tableId: event.tableId,
    rowId: event.rowId, rowVersion: row.version ?? 1, expectedVersion: row.version ?? 1,
    status: "matched", snapshot: snapshot as unknown as Record<string, unknown> });
  await tx.insert(automationRuns).values(matched.map((rule) => ({ automationId: rule.id, workspaceId: rule.workspaceId,
    tableId: event.tableId, rowId: event.rowId, eventId: id, ruleVersion: rule.version,
    ruleSnapshot: rule as unknown as Record<string, unknown>, status: "queued",
    triggerType: (rule.trigger as AutomationRule["trigger"]).type,
    detail: { eventType: event.type, traceId: id },
  })));
  await tx.insert(automationOutbox).values({ eventId: id, queue: deps.automationQueueName,
    payload: { protocol: 1, eventId: id, generation: 0 } });
  deps.wakeAfterCommit?.(tx, { kind: "outbox" });
}

export type ExternalAutomationEvent = {
  id: string;
  organizationId: string;
  source: import("@tabdo/shared").AutomationSource;
  type: "webhook_received" | "message_received" | "schedule_due";
  occurredAt: string;
  data: Record<string, unknown>;
  traceId: string;
};
export type ExternalEventSnapshot = { protocol: 2; event: ExternalAutomationEvent; actorId: null; traceId: string };
export type AnyEventSnapshot = EventSnapshot | ExternalEventSnapshot;

export function eventBindingContext(snapshot: AnyEventSnapshot): Record<string, unknown> {
  if (snapshot.protocol === 1) return { ...snapshot.event, row: snapshot.row, cells: snapshot.row.cells, traceId: snapshot.traceId,
    source: { kind: "table", tableId: snapshot.event.tableId } };
  return { ...snapshot.event.data, id: snapshot.event.id, source: snapshot.event.source, type: snapshot.event.type,
    occurredAt: snapshot.event.occurredAt, traceId: snapshot.traceId };
}
function sameSource(a: import("@tabdo/shared").AutomationSource, b: import("@tabdo/shared").AutomationSource) {
  if (a.kind !== b.kind) return false;
  if (a.kind === "webhook" && b.kind === "webhook") return a.endpointId === b.endpointId;
  if (a.kind === "agentmail" && b.kind === "agentmail") return a.connectionId === b.connectionId && a.inboxId === b.inboxId;
  return a.kind === "schedule" && b.kind === "schedule" && a.cron === b.cron && a.timeZone === b.timeZone;
}
export function eventConditionsMatch(rule: AutomationRule, context: Record<string, unknown>): boolean {
  const conditions = rule.eventConditions ?? [];
  if (!conditions.length) return true;
  const syntheticColumns: ColumnDef[] = [], cells: Record<string, import("@tabdo/shared").CellValue> = {};
  const filters = conditions.map(condition => {
    let value: unknown;
    try { value = automationPath(context, condition.path); } catch { value = null; }
    const id = condition.id;
    const type = Array.isArray(value) ? "multi_select" : typeof value === "number" ? "number" : typeof value === "boolean" ? "checkbox" : "text";
    syntheticColumns.push({ id, tableId: "event", name: condition.path, type, config: {}, width: 160, sortOrder: 0, createdAt: new Date(0).toISOString() });
    cells[id] = value as import("@tabdo/shared").CellValue;
    return { id, columnId: id, op: condition.op, value: condition.value };
  });
  const row: RowData = { id: "event", tableId: "event", cells, sortOrder: 0, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };
  return automationConditionsMatch(row, syntheticColumns, filters, rule.conditionLogic);
}
/** Called by verified delivery and schedule transactions, never before authentication. */
export async function appendExternalAutomationEvent(deps: CommandDependencies, tx: Transaction, event: ExternalAutomationEvent, selectedRules?: AutomationRule[]) {
  const rawRules = selectedRules ?? await tx.select().from(automations).where(and(eq(automations.organizationId, event.organizationId),
    eq(automations.enabled, true), isNull(automations.deletedAt))) as unknown as AutomationRule[];
  const snapshot: ExternalEventSnapshot = { protocol: 2, event, actorId: null, traceId: event.traceId };
  const context = eventBindingContext(snapshot);
  const needsBody = event.source.kind === "agentmail" && (event.data.message as Record<string, unknown> | undefined)?.bodyMissing;
  const rules = rawRules.filter(rule => rule.organizationId === event.organizationId && sameSource(rule.source, event.source)
    && rule.trigger.type === event.type && (needsBody || eventConditionsMatch(rule, context)));
  if (!rules.length) return null;
  await tx.insert(automationEvents).values({ id: event.id, organizationId: event.organizationId, tableId: null, rowId: null,
    rowVersion: null, expectedVersion: null, snapshot: snapshot as unknown as Record<string, unknown>, status: "matched" });
  await tx.insert(automationRuns).values(rules.map(rule => ({ automationId: rule.id, workspaceId: rule.workspaceId, tableId: null, rowId: null, eventId: event.id,
    ruleVersion: rule.version, ruleSnapshot: rule as unknown as Record<string, unknown>, status: "queued", triggerType: rule.trigger.type,
    detail: { eventType: event.type, source: event.source, traceId: event.traceId } })));
  await tx.insert(automationOutbox).values({ eventId: event.id, queue: deps.automationQueueName, payload: { protocol: 1, eventId: event.id, generation: 0 } });
  deps.wakeAfterCommit?.(tx, { kind: "outbox" });
  return event.id;
}
