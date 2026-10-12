import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { automationRuns, columns, rows } from "../db/schema.js";
import {
  applyFilters,
  triggerMatches,
  type AutomationAction,
  type AutomationEvent,
  type AutomationRule,
  type CellValue,
  type ColumnDef,
  type RowData,
} from "@table/shared";
import { getEnabledAutomations } from "./crud.js";

/** Dynamic import to avoid circular init with commands/index */
async function cmds() {
  return import("../commands/index.js");
}

function toRowData(row: typeof rows.$inferSelect): RowData {
  return {
    id: row.id,
    tableId: row.tableId,
    cells: (row.cells ?? {}) as Record<string, CellValue>,
    sortOrder: row.sortOrder,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadColumns(tableId: string): Promise<ColumnDef[]> {
  const cols = await db.select().from(columns).where(eq(columns.tableId, tableId));
  return cols.map((c) => ({
    id: c.id,
    tableId: c.tableId,
    name: c.name,
    type: c.type,
    config: c.config ?? {},
    width: c.width,
    sortOrder: c.sortOrder,
    createdAt: c.createdAt,
  }));
}

function conditionsPass(rule: AutomationRule, row: RowData, cols: ColumnDef[]) {
  if (!rule.conditions?.length) return true;
  const matched = applyFilters([row], cols, {
    filters: rule.conditions,
    filterLogic: rule.conditionLogic ?? "and",
  });
  return matched.length > 0;
}

async function executeAction(
  action: AutomationAction,
  ctx: { tableId: string; rowId: string; rule: AutomationRule }
): Promise<Record<string, unknown>> {
  const { updateCell, updateCells } = await cmds();

  if (action.type === "update_field") {
    const updated = await updateCell({
      rowId: ctx.rowId,
      columnId: action.columnId,
      value: action.value,
      skipAutomation: true,
    });
    return {
      type: "update_field",
      columnId: action.columnId,
      value: action.value,
      rowVersion: updated.version,
    };
  }

  if (action.type === "run_agent") {
    const detail: Record<string, unknown> = {
      type: "run_agent",
      agentUserId: action.agentUserId ?? null,
      prompt: action.prompt ?? null,
      mock: true,
    };

    // Optional person assignment
    if (action.agentUserId) {
      // find a person column? skip — caller can use update_field separately
      detail.agentAssigned = action.agentUserId;
    }

    if (action.resultColumnId !== undefined) {
      const updated = await updateCell({
        rowId: ctx.rowId,
        columnId: action.resultColumnId,
        value: action.resultValue ?? `agent:${action.agentUserId ?? "system"}`,
        skipAutomation: true,
      });
      detail.resultColumnId = action.resultColumnId;
      detail.resultValue = action.resultValue ?? null;
      detail.rowVersion = updated.version;
    }

    // Multi-field writeback via updateCells if both prompt metadata needed — keep simple
    if (action.agentUserId && !action.resultColumnId) {
      // no-op write; run is still logged
    }

    return detail;
  }

  return { type: "unknown" };
}

async function runRule(
  rule: AutomationRule,
  event: AutomationEvent,
  row: RowData,
  cols: ColumnDef[]
) {
  const [run] = await db
    .insert(automationRuns)
    .values({
      automationId: rule.id,
      tableId: event.tableId,
      rowId: row.id,
      status: "running",
      triggerType: rule.trigger.type,
      detail: { eventType: event.type },
    })
    .returning();

  try {
    if (!conditionsPass(rule, row, cols)) {
      await db
        .update(automationRuns)
        .set({
          status: "skipped",
          detail: { eventType: event.type, reason: "conditions_not_met" },
          finishedAt: new Date(),
        })
        .where(eq(automationRuns.id, run.id));
      return;
    }

    const results: Record<string, unknown>[] = [];
    for (const action of rule.actions) {
      results.push(await executeAction(action, {
        tableId: event.tableId,
        rowId: row.id,
        rule,
      }));
    }

    await db
      .update(automationRuns)
      .set({
        status: "completed",
        detail: { eventType: event.type, actions: results },
        finishedAt: new Date(),
      })
      .where(eq(automationRuns.id, run.id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(automationRuns)
      .set({
        status: "failed",
        error: msg,
        finishedAt: new Date(),
      })
      .where(eq(automationRuns.id, run.id));
    console.error("[automation] rule failed", rule.id, msg);
  }
}

/**
 * Dispatch Feishu-style automations for a mutation event.
 * Fire-and-forget safe: errors are logged per-run, never throw to callers.
 */
export async function dispatchAutomationEvent(event: AutomationEvent): Promise<void> {
  try {
    const rules = await getEnabledAutomations(event.tableId);
    if (!rules.length) return;

    const matching = rules.filter((r) => triggerMatches(r.trigger, event));
    if (!matching.length) return;

    const [row] = await db.select().from(rows).where(eq(rows.id, event.rowId));
    if (!row) return;
    const rowData = toRowData(row);
    const cols = await loadColumns(event.tableId);

    for (const rule of matching) {
      await runRule(rule, event, rowData, cols);
    }
  } catch (e) {
    console.error("[automation] dispatch error", e);
  }
}

/** Schedule without blocking the mutation response */
export function scheduleAutomationEvent(event: AutomationEvent): void {
  void dispatchAutomationEvent(event);
}
