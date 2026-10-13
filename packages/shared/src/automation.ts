import type { CellValue } from "./types.js";
import type { AutomationSource, AutomationDataCommand, AutomationEventCondition } from "./automation-contracts.js";
import type { FilterCondition, FilterLogic } from "./filters.js";

/** Sources and actions compose independently of the underlying data layout. */
export const AUTOMATION_TRIGGERS = [
  "row_created",
  "field_changed",
  "enter_status",
  "webhook_received",
  "message_received",
  "schedule_due",
] as const;

export type AutomationTriggerType = (typeof AUTOMATION_TRIGGERS)[number];

export type AutomationTrigger =
  | { type: "webhook_received" }
  | { type: "message_received" }
  | { type: "schedule_due" }
  | { type: "row_created" }
  | {
      type: "field_changed";
      columnId: string;
      /** if set, only when new value equals this */
      toValue?: CellValue;
    }
  | {
      type: "enter_status";
      /** select / status column */
      columnId: string;
      /** option id entered */
      optionId: string;
    };

export const AUTOMATION_ACTIONS = ["update_field", "run_agent", "command"] as const;
export type AutomationActionType = (typeof AUTOMATION_ACTIONS)[number];

export type UpdateFieldAction = {
  type: "update_field";
  columnId: string;
  value: CellValue;
};

export type RunAgentAction = {
  type: "run_agent";
  /** Agent user ID; shared across table, incoming events and scheduled tasks. */
  agentUserId?: string | null;
  prompt?: string;
  /** Legacy persisted configuration only; never interpreted as an agent result. */
  resultColumnId?: string;
  resultValue?: CellValue;
};

export type DataCommandAction = { type: "command"; command: AutomationDataCommand; input: Record<string, unknown> };
export type AutomationAction = UpdateFieldAction | RunAgentAction | DataCommandAction;

export type AutomationRule = {
  id: string;
  tableId: string | null;
  organizationId: string;
  createdByUserId: string | null;
  source: AutomationSource;
  eventConditions: AutomationEventCondition[];
  name: string;
  enabled: boolean;
  version: number;
  trigger: AutomationTrigger;
  conditions: FilterCondition[];
  conditionLogic: FilterLogic;
  actions: AutomationAction[];
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type AutomationRunStatus = "queued" | "running" | "retrying" | "waiting_input" | "completed" | "failed" | "skipped" | "cancelled" | "superseded" | "unknown";

export type AutomationRun = {
  id: string;
  automationId: string;
  tableId: string | null;
  rowId: string | null;
  status: AutomationRunStatus;
  eventId?: string | null;
  threadId?: string | null;
  attempts?: number;
  nextStep?: number;
  triggerType: AutomationTriggerType;
  detail: Record<string, unknown>;
  error: string | null;
  createdAt: string | Date;
  finishedAt: string | Date | null;
};

export const AUTOMATION_TRIGGER_LABELS: Record<AutomationTriggerType, string> = {
  row_created: "当新增记录时",
  field_changed: "当字段变更时",
  enter_status: "当进入某状态时",
  webhook_received: "当收到 Webhook 时",
  message_received: "当收到邮件时",
  schedule_due: "按时间计划",
};

export const AUTOMATION_ACTION_LABELS: Record<AutomationActionType, string> = {
  update_field: "更新字段",
  run_agent: "执行智能体",
  command: "操作数据",
};

export type CreateAutomationInput = {
  tableId?: string;
  source?: AutomationSource;
  eventConditions?: AutomationEventCondition[];
  name: string;
  enabled?: boolean;
  trigger: AutomationTrigger;
  conditions?: FilterCondition[];
  conditionLogic?: FilterLogic;
  actions: AutomationAction[];
};

export type UpdateAutomationInput = {
  automationId: string;
  source?: AutomationSource;
  eventConditions?: AutomationEventCondition[];
  name?: string;
  enabled?: boolean;
  trigger?: AutomationTrigger;
  conditions?: FilterCondition[];
  conditionLogic?: FilterLogic;
  actions?: AutomationAction[];
};

export type ListAutomationsInput = { tableId: string };
export type GetAutomationInput = { automationId: string };
export type DeleteAutomationInput = { automationId: string };
export type ListAutomationRunsInput = {
  tableId: string;
  automationId?: string;
  limit?: number;
};

/** Event emitted after a command-layer mutation for the automation engine */
export type AutomationEvent =
  | {
      type: "row_created";
      tableId: string;
      rowId: string;
      cells: Record<string, CellValue>;
    }
  | {
      type: "cells_changed";
      tableId: string;
      rowId: string;
      /** previous cell snapshot */
      before: Record<string, CellValue>;
      /** after cell snapshot */
      after: Record<string, CellValue>;
      /** column ids that changed */
      changedColumnIds: string[];
    };

export function changedColumns(
  before: Record<string, CellValue>,
  after: Record<string, CellValue>
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: string[] = [];
  for (const k of keys) {
    const a = before[k] ?? null;
    const b = after[k] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(k);
  }
  return out;
}

export function triggerMatches(
  trigger: AutomationTrigger,
  event: AutomationEvent
): boolean {
  if (trigger.type === "row_created") {
    return event.type === "row_created";
  }
  if (event.type !== "cells_changed") return false;

  if (trigger.type === "field_changed") {
    if (!event.changedColumnIds.includes(trigger.columnId)) return false;
    if (trigger.toValue !== undefined) {
      return JSON.stringify(event.after[trigger.columnId] ?? null) ===
        JSON.stringify(trigger.toValue);
    }
    return true;
  }

  if (trigger.type === "enter_status") {
    if (!event.changedColumnIds.includes(trigger.columnId)) return false;
    const prev = event.before[trigger.columnId] ?? null;
    const next = event.after[trigger.columnId] ?? null;
    return next === trigger.optionId && prev !== trigger.optionId;
  }

  return false;
}
