import type { CellValue, ColumnDef, RowData } from "./types.js";
import type { AutomationSource, AutomationDataCommand, AutomationEventCondition } from "./automation-contracts.js";
import { applyFilters, FILTER_OPS, isFilterConditionComplete, type FilterCondition, type FilterLogic } from "./filters.js";

/** Sources and actions compose independently of the underlying data layout. */
export const AUTOMATION_TRIGGERS = [
  "row_created",
  "field_changed",
  "enter_status",
  "webhook_received",
  "message_received",
  "schedule_due", "booking_reminder_due", "booking_due",
] as const;

export type AutomationTriggerType = (typeof AUTOMATION_TRIGGERS)[number];

export type AutomationTrigger =
  | { type: "webhook_received" }
  | { type: "message_received" }
  | { type: "schedule_due" }
  | { type: "booking_reminder_due" }
  | { type: "booking_due" }
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

export const AUTOMATION_ACTIONS = ["update_field", "run_agent", "command", "send_email", "reply_email"] as const;
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
export type MailAutomationAction = import("zod").z.infer<typeof import("./automation-contracts.js").AUTOMATION_SEND_EMAIL_SCHEMA> | import("zod").z.infer<typeof import("./automation-contracts.js").AUTOMATION_REPLY_EMAIL_SCHEMA>;
export type AutomationAction = UpdateFieldAction | RunAgentAction | DataCommandAction | MailAutomationAction;

export type AutomationRule = {
  id: string;
  tableId: string | null;
  organizationId: string;
  workspaceId: string;
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
  workspaceId: string;
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
  booking_reminder_due: "预约开始前",
  booking_due: "预约到期",
};

export const AUTOMATION_ACTION_LABELS: Record<AutomationActionType, string> = {
  send_email: "发送邮件",
  reply_email: "回复邮件",
  update_field: "更新字段",
  run_agent: "执行智能体",
  command: "操作数据",
};

export type CreateAutomationInput = {
  /** Required by external API keys; session callers retain their selected workspace. */
  workspaceId?: string;
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
  expectedVersion?: number;
  source?: AutomationSource;
  eventConditions?: AutomationEventCondition[];
  name?: string;
  enabled?: boolean;
  trigger?: AutomationTrigger;
  conditions?: FilterCondition[];
  conditionLogic?: FilterLogic;
  actions?: AutomationAction[];
};

export type ListAutomationsInput = { tableId?: string; offset?: number; limit?: number };
export type GetAutomationInput = { automationId: string };
export type DeleteAutomationInput = { automationId: string };
export type ListAutomationRunsInput = {
  tableId?: string;
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
    const contains = (value: CellValue) => Array.isArray(value) ? value.includes(trigger.optionId) : value === trigger.optionId;
    return contains(next) && !contains(prev);
  }

  return false;
}

/** Saved automation conditions fail closed; view drafts may skip incomplete filters. */
export function automationConditionsMatch(row: RowData, columns: ColumnDef[], conditions: FilterCondition[], logic: FilterLogic): boolean {
  if (conditions.some(condition => !isFilterConditionComplete(condition) || !FILTER_OPS.includes(condition.op)
    || !columns.some(column => column.id === condition.columnId))) return false;
  return applyFilters([row], columns, { filters: conditions, filterLogic: logic }).length > 0;
}

/** A scheduled occurrence projects its private native conversation, without copying messages. */
export type ScheduledTaskRun = {
  id: string; automationId: string; status: AutomationRunStatus;
  createdAt: string | Date; finishedAt: string | Date | null; error: string | null;
  threadId: string | null; title: string | null; prompt: string;
  preview: string | null; nativeStatus: import("./chat.js").AgentRunStatus | null;
};
