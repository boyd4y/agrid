import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { AUTOMATION_CREATE_SCHEMA, AUTOMATION_UPDATE_SCHEMA, AUTOMATION_LIST_SCHEMA, AUTOMATION_RUN_LIST_SCHEMA, type AutomationRule, type AutomationAction } from "@tabdo/shared";
import type { CommandDependencies } from "../dependencies.js";
import type { Transaction } from "../db/types.js";
import { automations, automationRuns, rows, tables } from "../db/schema.js";
import { createAutomation, updateAutomation, deleteAutomation, mapRule } from "../automation/crud.js";
import { requireWorkspace } from "../tenant/workspace.js";
import { ServiceError } from "../errors.js";
import { resolveSiteKey, requireSiteTable, type SitePrincipal, type Operation } from "./keys.js";
import { tableColumns, readableColumn } from "./data.js";

const forbidden = (message: string): never => { throw new ServiceError(403, { message }); };
export const keyAutomationCommands = ["listAutomations", "listAutomationRuns", "createAutomation", "updateAutomation", "deleteAutomation"];
export function automationGrant(principal: SitePrincipal, rule: Pick<AutomationRule, "id" | "source">) {
  return (rule.source.kind === "schedule" ? principal.schedulePermissions : principal.automationPermissions)?.get(rule.id);
}
async function sourceAccess(tx: Transaction, principal: SitePrincipal, source: AutomationRule["source"]) {
  if (source.kind === "table") {
    requireSiteTable(principal, source.tableId, "read");
    const { cols } = await tableColumns(tx, principal, source.tableId, "read");
    // Triggers snapshot the source row, including computed values. Do not capture private linked data.
    if (cols.some(col => !readableColumn(col, cols, principal))) forbidden("The automation source includes unreadable linked data");
  } else if (source.kind === "calendar") forbidden("Manage calendar reminders through the calendar commands");
}
/** Only data actions whose real targets can be checked against the key are externally executable. */
export async function authorizeKeyAction(tx: Transaction, principal: SitePrincipal, rule: Pick<AutomationRule, "source">, action: AutomationAction, runtimeInput?: Record<string, unknown>) {
  let tableId: string, operation: Operation;
  if (action.type === "update_field") {
    if (rule.source.kind !== "table") forbidden("Field updates require a table source");
    tableId = (rule.source as { tableId: string }).tableId; operation = "update";
  } else {
    if (action.type !== "command" || !["addRow", "updateCell", "updateCells", "deleteRow"].includes(action.command))
      forbidden("API key automations support table record actions only; agent, mail and schema actions require a member");
    if (action.type !== "command") return;
    const input = runtimeInput ?? action.input;
    operation = action.command === "addRow" ? "create" : action.command === "deleteRow" ? "delete" : "update";
    if (operation === "create") tableId = z.uuid().parse(input.tableId);
    else if (typeof input.rowId === "string") {
      const [row] = await tx.select({ tableId: rows.tableId }).from(rows).innerJoin(tables, eq(tables.id, rows.tableId))
        .where(and(eq(rows.id, z.uuid().parse(input.rowId)), eq(tables.organizationId, principal.organizationId)));
      if (!row) throw new ServiceError(404, { message: "Record not found" });
      tableId = row.tableId;
    } else if (!runtimeInput && rule.source.kind === "table" && JSON.stringify(input.rowId) === '{"$event":"row.id"}') tableId = rule.source.tableId;
    else forbidden("Use a literal record ID or the source row.id binding for record actions");
  }
  requireSiteTable(principal, tableId!, operation);
  const { cols } = await tableColumns(tx, principal, tableId!, operation);
  if (operation !== "delete") {
    const input = runtimeInput ?? (action.type === "command" ? action.input : {});
    const ids = action.type === "update_field" ? [action.columnId] : action.type === "command" && action.command === "updateCell" ? [input.columnId] : Object.keys((input.cells ?? {}) as object);
    const writable = new Set(["text", "number", "date", "checkbox", "select", "multi_select"]);
    if (ids.some(id => typeof id !== "string" || !cols.some(col => col.id === id && writable.has(col.type)))) forbidden("Key automation actions can only write ordinary table fields");
  }
}
export async function authorizeKeyRule(tx: Transaction, principal: SitePrincipal, rule: Pick<AutomationRule, "source" | "actions">) {
  await sourceAccess(tx, principal, rule.source);
  if (!["table", "schedule"].includes(rule.source.kind)) forbidden("API keys cannot execute integration sources");
  if (rule.source.kind === "table") {
    const { cols } = await tableColumns(tx, principal, rule.source.tableId, "read");
    const validateBindings = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if (Object.hasOwn(value, "$event")) {
        const path = (value as { $event: unknown }).$event;
        if (path !== "row.id" && !(typeof path === "string" && path.startsWith("row.cells.") && cols.some(col => path === `row.cells.${col.id}` && readableColumn(col, cols, principal))))
          forbidden("Key table event bindings must reference the source row ID or a current readable cell");
      }
      for (const nested of Object.values(value)) validateBindings(nested);
    };
    for (const action of rule.actions) if (action.type === "command") validateBindings(action.input);
  }
  for (const action of rule.actions) await authorizeKeyAction(tx, principal, rule, action);
}
export async function executeKeyAutomation(deps: CommandDependencies, secret: string, command: string, raw: Record<string, unknown>) {
  return deps.database.transaction(async tx => {
    const principal = await resolveSiteKey(tx, secret, true);
    if (command === "createAutomation") {
      if (![...(principal.workspacePermissions?.values() ?? [])].some(g => g.canCreateAutomations || g.canCreateSchedules)) forbidden("Automation creation is not granted");
      const { workspaceId, ...input } = AUTOMATION_CREATE_SCHEMA.parse(raw);
      if (!workspaceId) throw new ServiceError(400, { message: "workspaceId is required to create an automation" });
      await requireWorkspace({ ...deps, workspaceId }, principal.organizationId, tx);
      const source = input.source ?? { kind: "table" as const, tableId: input.tableId! };
      const workspaceGrant = principal.workspacePermissions?.get(workspaceId);
      if (!(source.kind === "schedule" ? workspaceGrant?.canCreateSchedules : workspaceGrant?.canCreateAutomations)) forbidden("Automation creation is not granted in this workspace");
      if (!principal.userId) forbidden("A current key owner is required to create automations");
      await authorizeKeyRule(tx, principal, { source, actions: input.actions });
      const result = await createAutomation({ ...deps, workspaceId }, { ...input, organizationId: principal.organizationId, actorId: principal.userId! }, tx);
      await tx.update(automations).set({ executionKeyId: principal.id }).where(eq(automations.id, result.id));
      // Creating a resource grants no read/update/delete access implicitly.
      return result;
    }
    if (command === "listAutomations") {
      const input = AUTOMATION_LIST_SCHEMA.parse(raw);
      if (input.tableId) requireSiteTable(principal, input.tableId, "read");
      const ids = [...(principal.automationPermissions?.values() ?? []), ...(principal.schedulePermissions?.values() ?? [])].filter(g => g.canRead).map(g => g.automationId);
      if (!ids.length) return [];
      const hits = await tx.select().from(automations).where(and(eq(automations.organizationId, principal.organizationId), inArray(automations.id, ids), isNull(automations.deletedAt),
        input.tableId ? eq(automations.tableId, input.tableId) : undefined, sql`${automations.source}->>'kind' <> 'calendar'`)).orderBy(asc(automations.createdAt), asc(automations.id)).offset(input.offset ?? 0).limit(input.limit ?? 100);
      for (const rule of hits) await sourceAccess(tx, principal, rule.source);
      return hits.map(mapRule);
    }
    if (command === "listAutomationRuns") {
      const input = AUTOMATION_RUN_LIST_SCHEMA.parse(raw);
      if (!input.automationId) throw new ServiceError(400, { message: "Select an automationId explicitly" });
      const rule = await ownedRule(tx, principal, input.automationId, "canRead");
      await sourceAccess(tx, principal, rule.source);
      if (input.tableId && input.tableId !== rule.tableId) throw new ServiceError(404, { message: "Automation not found" });
      const hits = await tx.select().from(automationRuns).where(eq(automationRuns.automationId, rule.id)).orderBy(asc(automationRuns.createdAt)).limit(input.limit ?? 50);
      // Execution results and private agent threads require their own access; a rule grant is not data access.
      return hits.map(({ ruleSnapshot: _, detail: __, error: ___, ...run }) => ({ ...run, detail: {}, error: null, threadId: null }));
    }
    const automationId = z.uuid().parse(raw.automationId);
    const rule = await ownedRule(tx, principal, automationId, command === "deleteAutomation" ? "canDelete" : "canUpdate");
    const scoped = { ...deps, workspaceId: rule.workspaceId };
    if (command === "deleteAutomation") return deleteAutomation(scoped, { automationId, organizationId: principal.organizationId }, tx);
    const { automationId: _, ...wire } = raw;
    const input = AUTOMATION_UPDATE_SCHEMA.parse(wire);
    if (!input.expectedVersion) throw new ServiceError(400, { message: "expectedVersion is required" });
    const merged = { ...mapRule(rule), ...input };
    const harmless = Object.keys(input).every(key => ["name", "expectedVersion", "enabled"].includes(key)) && input.enabled !== true;
    if (!harmless) {
      // Legacy schedule update grants retain their timing-only semantics; no implicit action editing.
      if (rule.source.kind === "schedule" && (principal.schedulePermissions?.get(rule.id)?.grantVersion ?? 1) < 2 && (input.actions || input.trigger || input.conditions || input.eventConditions || input.conditionLogic)) forbidden("This schedule grant only allows timing, name and enabled changes");
      await authorizeKeyRule(tx, principal, merged);
    }
    const result = await updateAutomation(scoped, { ...input, automationId, organizationId: principal.organizationId, actorId: principal.userId ?? undefined }, tx);
    if (!harmless) await tx.update(automations).set({ executionKeyId: principal.id }).where(eq(automations.id, automationId));
    return { automationId: result.id, version: result.version, name: result.name, enabled: result.enabled, source: result.source };
  });
}
async function ownedRule(tx: Transaction, principal: SitePrincipal, id: string, operation: "canRead" | "canUpdate" | "canDelete") {
  const [rule] = await tx.select().from(automations).where(and(eq(automations.id, id), eq(automations.organizationId, principal.organizationId), isNull(automations.deletedAt))).for("update");
  if (!rule || rule.source.kind === "calendar") throw new ServiceError(404, { message: "Automation not found" });
  if (!automationGrant(principal, rule)?.[operation]) forbidden("This API key does not grant the requested automation operation");
  return rule;
}
