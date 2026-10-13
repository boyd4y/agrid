import { updateCellsInTransaction } from "../commands/index.js";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  validateCell,
  type AutomationRule,
  type CellValue,
} from "@tabdo/shared";
import { db, type Transaction } from "../db/index.js";
import {
  automationEvents,
  automationOutbox,
  automationRuns,
  automationStepReceipts,
  automations,
  columns,
  rows,
  tables,
  member,
} from "../db/schema.js";
import { loadTableColumns } from "../commands/formulas.js";
import type { EventSnapshot } from "./events.js";

export const terminal = [
  "completed",
  "failed",
  "cancelled",
  "superseded",
  "unknown",
];
const unfinishedRuns = ["queued", "running", "retrying"];
type EventRow = typeof automationEvents.$inferSelect;
export class PermanentError extends Error {}
export class FenceLostError extends Error {}

/** The event lock serializes progress/receipts, not work scheduling. */
export async function finishEvent(
  tx: Transaction,
  event: EventRow,
  status: string,
  error?: string,
) {
  if (event.finishedAt) return;
  await tx
    .update(automationEvents)
    .set({
      status,
      error: error ?? null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(automationEvents.id, event.id));
  if (status !== "completed")
    await tx
      .update(automationRuns)
      .set({ status, error: error ?? null, finishedAt: new Date() })
      .where(
        and(
          eq(automationRuns.eventId, event.id),
          inArray(automationRuns.status, unfinishedRuns),
        ),
      );
  await tx
    .update(automationOutbox)
    .set({ status: "done", claimToken: null, claimUntil: null })
    .where(
      and(
        eq(automationOutbox.eventId, event.id),
        eq(automationOutbox.generation, event.generation),
      ),
    );
}

export async function claimExecution(id: string, generation?: number) {
  return db.transaction(async (tx) => {
    const [event] = await tx
      .update(automationEvents)
      .set({
        fence: sql`${automationEvents.fence} + 1`,
        status: "running",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(automationEvents.id, id),
          inArray(automationEvents.status, ["matched", "running", "retrying"]),
          ...(generation === undefined
            ? []
            : [eq(automationEvents.generation, generation)]),
        ),
      )
      .returning();
    if (!event) return undefined;
    await tx
      .update(automationRuns)
      .set({ status: "running", attempts: sql`${automationRuns.attempts} + 1` })
      .where(
        and(
          eq(automationRuns.eventId, id),
          inArray(automationRuns.status, unfinishedRuns),
        ),
      );
    return event.fence;
  });
}

/** One short, atomic action: side effect + receipt + cursor + next row version. */
export async function executeNext(
  id: string,
  fence: number,
): Promise<"continue" | "done"> {
  return db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(automationEvents)
      .where(eq(automationEvents.id, id))
      .for("update");
    if (!event || event.finishedAt) return "done";
    if (event.fence !== fence) throw new FenceLostError("执行租约已被接管");
    const [run] = await tx
      .select()
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.eventId, id),
          inArray(automationRuns.status, unfinishedRuns),
        ),
      )
      .orderBy(asc(automationRuns.createdAt), asc(automationRuns.automationId))
      .limit(1)
      .for("update");
    if (!run) {
      await finishEvent(tx, event, "completed");
      return "done";
    }
    const rule = run.ruleSnapshot as unknown as AutomationRule;
    const snapshot = event.snapshot as unknown as EventSnapshot;
    if (snapshot.actorId) {
      const [membership] = await tx
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.organizationId, event.organizationId),
            eq(member.userId, snapshot.actorId),
          ),
        )
        .for("share");
      if (!membership) {
        await finishEvent(tx, event, "cancelled", "触发者已不在工作区中");
        return "done";
      }
    }
    const [table] = await tx
      .select()
      .from(tables)
      .where(eq(tables.id, event.tableId))
      .for("share");
    const [row] = await tx.select().from(rows).where(eq(rows.id, event.rowId));
    const [currentRule] = await tx
      .select()
      .from(automations)
      .where(eq(automations.id, run.automationId))
      .for("share");
    if (
      !table ||
      table.organizationId !== event.organizationId ||
      !row ||
      row.tableId !== event.tableId
    ) {
      await finishEvent(tx, event, "cancelled", "触发记录或表格已删除");
      return "done";
    }
    if (
      !currentRule ||
      currentRule.deletedAt ||
      !currentRule.enabled ||
      currentRule.tableId !== event.tableId
    ) {
      await tx
        .update(automationRuns)
        .set({
          status: "cancelled",
          error: "规则已停用或删除",
          finishedAt: new Date(),
        })
        .where(eq(automationRuns.id, run.id));
      return "continue";
    }
    if (row.version !== event.expectedVersion) {
      await finishEvent(
        tx,
        event,
        "superseded",
        "触发后记录已更新，取消旧事件写回",
      );
      return "done";
    }
    const action = rule.actions[run.nextStep];
    if (!action) {
      await tx
        .update(automationRuns)
        .set({ status: "completed", finishedAt: new Date() })
        .where(eq(automationRuns.id, run.id));
      return "continue";
    }
    if (action.type === "run_agent") {
      // No silent mock success. Real agent runtime is a separate, explicitly deferred phase.
      throw new PermanentError(
        "后台智能体运行时尚未接入；此动作未执行，不会模拟成功或写入占位结果",
      );
    }
    if (action.type !== "update_field")
      throw new PermanentError("不支持的动作类型");
    const cols = await loadTableColumns(event.tableId, tx);
    const col = cols.find((c) => c.id === action.columnId);
    const original = (event.snapshot as unknown as EventSnapshot).columns.find(
      (c) => c.id === action.columnId,
    );
    if (
      !col ||
      !original ||
      col.type !== original.type ||
      col.type === "formula" ||
      col.type === "rollup"
    ) {
      await finishEvent(tx, event, "cancelled", "动作目标列已删除或类型已变更");
      return "done";
    }
    const invalid = validateCell(col.type, action.value, col.config?.options);
    if (invalid) throw new PermanentError(`动作值无效: ${invalid}`);
    const [receipt] = await tx
      .select()
      .from(automationStepReceipts)
      .where(
        and(
          eq(automationStepReceipts.runId, run.id),
          eq(automationStepReceipts.step, run.nextStep),
        ),
      );
    if (receipt)
      throw new PermanentError("动作游标与完成凭据不一致，请检查执行记录");
    const updated = await updateCellsInTransaction(tx, {
      rowId: row.id,
      cells: { [col.id]: action.value },
      expectedVersion: event.expectedVersion,
      organizationId: event.organizationId,
      skipAutomation: true,
    });
    const result = {
      type: action.type,
      columnId: col.id,
      value: action.value,
      rowVersion: updated.version,
    };
    await tx
      .insert(automationStepReceipts)
      .values({ runId: run.id, step: run.nextStep, result });
    const complete = run.nextStep + 1 === rule.actions.length;
    await tx
      .update(automationRuns)
      .set({
        nextStep: run.nextStep + 1,
        status: complete ? "completed" : "running",
        finishedAt: complete ? new Date() : null,
        error: null,
        detail: {
          ...run.detail,
          actions: [
            ...(Array.isArray(run.detail.actions) ? run.detail.actions : []),
            result,
          ],
        },
      })
      .where(eq(automationRuns.id, run.id));
    await tx
      .update(automationEvents)
      .set({ expectedVersion: updated.version, updatedAt: new Date() })
      .where(eq(automationEvents.id, id));
    return "continue";
  });
}

export async function recordFailure(
  id: string,
  error: Error,
  final: boolean,
  fence?: number,
  generation?: number,
) {
  await db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(automationEvents)
      .where(eq(automationEvents.id, id))
      .for("update");
    if (
      !event ||
      event.finishedAt ||
      (fence !== undefined && event.fence !== fence) ||
      (generation !== undefined && event.generation !== generation)
    )
      return;
    if (final) {
      await finishEvent(tx, event, "failed", error.message);
      return;
    }
    await tx
      .update(automationEvents)
      .set({
        status: event.status === "queued" ? "queued" : "retrying",
        error: error.message,
        updatedAt: new Date(),
      })
      .where(eq(automationEvents.id, id));
    await tx
      .update(automationRuns)
      .set({ status: "retrying", error: error.message })
      .where(
        and(
          eq(automationRuns.eventId, id),
          inArray(automationRuns.status, unfinishedRuns),
        ),
      );
  });
}
