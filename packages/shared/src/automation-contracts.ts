import { z } from "zod";
import { ADD_COLUMN_SCHEMA, UPDATE_COLUMN_SCHEMA, BATCH_ADD_COLUMNS_SCHEMA, BATCH_UPDATE_COLUMNS_SCHEMA, BATCH_DELETE_COLUMNS_SCHEMA } from "./batch-columns.js";
import { BATCH_ADD_ROWS_SCHEMA, BATCH_UPDATE_ROWS_SCHEMA, BATCH_DELETE_ROWS_SCHEMA } from "./batch-rows.js";
import { BATCH_SET_RELATIONS_SCHEMA } from "./batch-relations.js";
import type { CommandInputMap } from "./commands.js";
import type { AutomationAction } from "./automation.js";

const uuid = z.string().uuid();
const value = z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.string()), z.null()]);
const cells = z.record(uuid, value);
const version = z.number().int().positive().optional();
const relation = z.object({ rowId: uuid, columnId: uuid, recordIds: z.array(uuid), expectedVersion: version }).strict();
const status = z.object({ rowId: uuid, columnId: uuid, statusOptionId: z.string().min(1) }).strict();

/** The same finite command surface for table, mail, webhook and scheduled actions. */
export const AUTOMATION_DATA_COMMAND_SCHEMAS = {
  addRow: z.object({ tableId: uuid, cells: cells.optional() }).strict(),
  updateCell: z.object({ rowId: uuid, columnId: uuid, value, expectedVersion: version }).strict(),
  updateCells: z.object({ rowId: uuid, cells, expectedVersion: version }).strict(),
  deleteRow: z.object({ rowId: uuid }).strict(),
  setStatus: status,
  moveCard: status,
  setRelation: relation,
  addRelation: relation,
  removeRelation: relation,
  addColumn: ADD_COLUMN_SCHEMA,
  updateColumn: UPDATE_COLUMN_SCHEMA,
  deleteColumn: z.object({ columnId: uuid }).strict(),
  reorderColumns: z.object({ tableId: uuid, columnIds: z.array(uuid).refine(ids => new Set(ids).size === ids.length, "字段不能重复") }).strict(),
  batchAddRows: BATCH_ADD_ROWS_SCHEMA,
  batchUpdateRows: BATCH_UPDATE_ROWS_SCHEMA,
  batchDeleteRows: BATCH_DELETE_ROWS_SCHEMA,
  batchAddColumns: BATCH_ADD_COLUMNS_SCHEMA,
  batchUpdateColumns: BATCH_UPDATE_COLUMNS_SCHEMA,
  batchDeleteColumns: BATCH_DELETE_COLUMNS_SCHEMA,
  batchSetRelations: BATCH_SET_RELATIONS_SCHEMA,
  batchAddRelations: BATCH_SET_RELATIONS_SCHEMA,
  batchRemoveRelations: BATCH_SET_RELATIONS_SCHEMA,
} as const;
export type AutomationDataCommand = keyof typeof AUTOMATION_DATA_COMMAND_SCHEMAS;
export const AUTOMATION_DATA_COMMANDS = Object.keys(AUTOMATION_DATA_COMMAND_SCHEMAS) as [AutomationDataCommand, ...AutomationDataCommand[]];
export function parseAutomationCommand<K extends AutomationDataCommand>(command: K, input: unknown): CommandInputMap[K] {
  return AUTOMATION_DATA_COMMAND_SCHEMAS[command].parse(input) as CommandInputMap[K];
}

export const AUTOMATION_SOURCE_SCHEMA = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("table"), tableId: uuid }).strict(),
  z.object({ kind: z.literal("webhook"), endpointId: uuid }).strict(),
  z.object({ kind: z.literal("agentmail"), connectionId: uuid, inboxId: z.string().trim().min(1).max(300) }).strict(),
  z.object({ kind: z.literal("schedule"), cron: z.string().trim().min(1).max(200), timeZone: z.string().trim().min(1).max(100) }).strict(),
]);
export type AutomationSource = z.infer<typeof AUTOMATION_SOURCE_SCHEMA>;
export const AUTOMATION_EVENT_CONDITION_SCHEMA = z.object({
  id: z.string().min(1), path: z.string().min(1).max(500),
  op: z.enum(["eq", "neq", "contains", "not_contains", "is_empty", "is_not_empty", "gt", "gte", "lt", "lte"]),
  value: value.optional(),
}).strict();
export type AutomationEventCondition = z.infer<typeof AUTOMATION_EVENT_CONDITION_SCHEMA>;

export type AutomationJson = null | string | number | boolean | AutomationJson[] | { [key: string]: AutomationJson };
export type AutomationBindingContext = { event: Record<string, unknown>; steps: readonly unknown[] };
const unsafe = new Set(["__proto__", "constructor", "prototype"]);
/** References address own data properties only, never execute JS or access prototypes. */
export function automationPath(value: unknown, path: string): unknown {
  if (!path || path.length > 500) throw new Error("事件字段路径无效");
  const parts = path.split(".");
  let current = value;
  for (const part of parts) {
    if (!part || unsafe.has(part) || current === null || typeof current !== "object" || !Object.hasOwn(current, part))
      throw new Error(`事件字段不存在: ${path}`);
    current = (current as Record<string, unknown>)[part];
  }
  if (current === undefined) throw new Error(`事件字段不存在: ${path}`);
  return current;
}
/** An exact {$event:path} or {$step:{index,path}} preserves the actual JSON type. */
export function resolveAutomationBindings(input: unknown, context: AutomationBindingContext, depth = 0): unknown {
  if (depth > 30) throw new Error("动作输入层级过深");
  if (input === null || typeof input === "string" || typeof input === "boolean") return input;
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (Array.isArray(input)) return input.map(item => resolveAutomationBindings(item, context, depth + 1));
  if (!input || typeof input !== "object") throw new Error("动作输入必须是 JSON 数据");
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] === "$event") {
    if (typeof record.$event !== "string") throw new Error("事件引用必须是字段路径");
    return automationPath(context.event, record.$event);
  }
  if (keys.length === 1 && keys[0] === "$step") {
    const reference = z.object({ index: z.number().int().nonnegative(), path: z.string().min(1) }).strict().parse(record.$step);
    if (reference.index >= context.steps.length) throw new Error("只能引用已经完成的动作");
    return automationPath(context.steps[reference.index], reference.path);
  }
  return Object.fromEntries(keys.map(key => {
    if (unsafe.has(key) || key === "$event" || key === "$step") throw new Error("动作输入包含无效字段");
    return [key, resolveAutomationBindings(record[key], context, depth + 1)];
  }));
}
export function renderAutomationPrompt(template: string, context: AutomationBindingContext): string {
  return template.replace(/\{\{\s*(event|steps)\.([^{}]+?)\s*\}\}/g, (_match, root: string, path: string) => {
    const result = automationPath(root === "event" ? context.event : context.steps, path.trim());
    return typeof result === "string" ? result : JSON.stringify(result);
  });
}

export const AUTOMATION_FILTER_SCHEMA = z.object({ id: z.string().min(1), columnId: uuid,
  op: z.enum(["eq", "neq", "contains", "not_contains", "is_empty", "is_not_empty", "gt", "gte", "lt", "lte"]), value: value.optional() }).strict();
export const AUTOMATION_TRIGGER_SCHEMA = z.discriminatedUnion("type", [
  z.object({ type: z.literal("row_created") }).strict(),
  z.object({ type: z.literal("field_changed"), columnId: uuid, toValue: value.optional() }).strict(),
  z.object({ type: z.literal("enter_status"), columnId: uuid, optionId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("webhook_received") }).strict(),
  z.object({ type: z.literal("message_received") }).strict(),
  z.object({ type: z.literal("schedule_due") }).strict(),
]);
export const AUTOMATION_ACTION_SCHEMA = z.discriminatedUnion("type", [
  z.object({ type: z.literal("update_field"), columnId: uuid, value }).strict(),
  z.object({ type: z.literal("run_agent"), agentUserId: z.string().min(1), prompt: z.string().trim().min(1).max(30000) }).strict(),
  z.object({ type: z.literal("command"), command: z.enum(AUTOMATION_DATA_COMMANDS), input: z.record(z.string(), z.unknown()) }).strict(),
]);
export const AUTOMATION_CREATE_SCHEMA = z.object({ source: AUTOMATION_SOURCE_SCHEMA.optional(), tableId: uuid.optional(),
  name: z.string().trim().min(1).max(200), enabled: z.boolean().optional(), trigger: AUTOMATION_TRIGGER_SCHEMA,
  conditions: z.array(AUTOMATION_FILTER_SCHEMA).max(100).optional(), conditionLogic: z.enum(["and", "or"]).optional(),
  eventConditions: z.array(AUTOMATION_EVENT_CONDITION_SCHEMA).max(100).optional(), actions: z.array(AUTOMATION_ACTION_SCHEMA).min(1).max(100) }).strict();
export const AUTOMATION_UPDATE_SCHEMA = AUTOMATION_CREATE_SCHEMA.omit({ tableId: true }).partial();

/** Validate reference structure before saving, without requiring a live event. */
export function validateAutomationActionReferences(actions: readonly AutomationAction[]): void {
  const path = (value: unknown) => {
    if (typeof value !== "string" || !value || value.length > 500 || value.split(".").some(part => !part || unsafe.has(part)))
      throw new Error("动作引用字段路径无效");
  };
  const previous = (index: unknown, actionIndex: number) => {
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= actionIndex)
      throw new Error("动作只能引用前面已完成的动作，请检查删除或调整顺序后的引用");
  };
  const visit = (value: unknown, actionIndex: number, depth = 0): void => {
    if (depth > 30) throw new Error("动作输入层级过深");
    if (Array.isArray(value)) { value.forEach(item => visit(item, actionIndex, depth + 1)); return; }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (Object.hasOwn(record, "$event")) {
      if (keys.length !== 1) throw new Error("事件引用不能包含其他字段");
      path(record.$event); return;
    }
    if (Object.hasOwn(record, "$step")) {
      if (keys.length !== 1) throw new Error("动作引用不能包含其他字段");
      const reference = z.object({ index: z.number().int().nonnegative(), path: z.string().min(1) }).strict().parse(record.$step);
      previous(reference.index, actionIndex); path(reference.path); return;
    }
    for (const key of keys) {
      if (unsafe.has(key)) throw new Error("动作输入包含无效字段");
      visit(record[key], actionIndex, depth + 1);
    }
  };
  actions.forEach((action, index) => {
    if (action.type === "command") visit(action.input, index);
    if (action.type === "run_agent") {
      for (const match of (action.prompt ?? "").matchAll(/\{\{\s*(event|steps)\.([^{}]+?)\s*\}\}/g)) {
        const referencePath = match[2]!.trim(); path(referencePath);
        if (match[1] === "steps") {
          const [step, ...parts] = referencePath.split(".");
          if (!/^\d+$/.test(step!) || !parts.length) throw new Error("动作引用字段路径无效");
          previous(Number(step), index);
        }
      }
    }
  });
}
