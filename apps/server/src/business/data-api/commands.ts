import { isBlogCommand } from "../blogs/transport.js";
import { isDocumentCommand } from "../documents/transport.js";
import { executeSiteView, siteViewDetail } from "../commands/site-views.js";
import { executeRowAttachment } from "../commands/row-attachments.js";
import { listViews, getView, deleteView } from "../commands/views.js";
import { requireSiteTable, resolveSiteKey } from "./keys.js";
import { tableViews } from "../db/schema.js";
import { z } from "zod";
import { CALENDAR_READ_COMMANDS } from "@tabdo/shared";
import { and, eq } from "drizzle-orm";
import type { CommandDependencies } from "../dependencies.js";
import { rows, tables } from "../db/schema.js";
import { ServiceError } from "../errors.js";
import * as data from "./data.js";
import { siteQueryCalendarView } from "./calendar-views.js";
import { isCalendarCommand, calendarTransportInput } from "../calendar/transport.js";
import { executeCalendar } from "../calendar/service.js";
import { updateScheduledAutomation } from "../calendar/schedules.js";

const tableReadCommands = ["listTables", "getTable", "queryRows", "getRow"];
const readCommands = new Set<string>([
  ...tableReadCommands, "queryCalendarView", ...CALENDAR_READ_COMMANDS, "getView", "listViews", "getRowAttachment",
]);

/** Reuse each capability's read classification; unknown commands stay write-limited. */
export function keyCommandRateLimitKind(command: string): "read" | "create" {
  return readCommands.has(command) ? "read" : "create";
}

/** The same capability command boundary for REST and remote MCP. */
export async function dispatchKeyCommand(deps: CommandDependencies, context: data.SiteContext, body: Record<string, unknown>, idempotencyKey?: string) {
  context = { ...context, principal: await resolveSiteKey(deps.database, context.secret) };
  const locate = async (rowId: unknown) => {
    const id = z.uuid().parse(rowId);
    const [found] = await deps.database.select({ tableId: rows.tableId }).from(rows).innerJoin(tables, eq(tables.id, rows.tableId))
      .where(and(eq(rows.id, id), eq(tables.organizationId, context.principal.organizationId)));
    if (!found) throw new ServiceError(404, { message: "Record not found" }); return found.tableId;
  };
  const command = z.string().parse(body.command), args = z.record(z.string(), z.unknown()).parse(body.input ?? {});
  if (["workspaceId", "organizationId", "actorId", "skipAutomation", "receiptPrincipalId"].some(key => Object.hasOwn(args, key))) throw new ServiceError(400, { message: "Internal execution options cannot be supplied" });
  if (isBlogCommand(command) || isDocumentCommand(command)) throw new ServiceError(410, { message: "Retired command; use row body, row attachments and table views" });
  if (idempotencyKey) {
    if (args.idempotencyKey !== undefined && args.idempotencyKey !== idempotencyKey) throw new ServiceError(400, { message: "Idempotency-Key must match the input" });
    args.idempotencyKey = idempotencyKey;
  }
  if (command === "createView" || command === "updateView") return { ok: true, command, result: await executeSiteView(deps, { kind: "key", secret: context.secret }, command, args) };
  if (command === "getRowAttachment" || command === "uploadRowAttachment") return { ok: true, command, result: await executeRowAttachment(deps, { kind: "key", secret: context.secret }, command, args) };
  if (["listViews", "getView", "deleteView"].includes(command)) {
    const result = await deps.database.transaction(async tx => {
      const principal = await resolveSiteKey(tx, context.secret, true);
      const [view] = command !== "listViews" ? await tx.select().from(tableViews).where(eq(tableViews.id, z.uuid().parse(args.viewId))) : [];
      const tableId = command === "listViews" ? z.uuid().parse(args.tableId) : view?.tableId;
      if (!tableId) throw new ServiceError(404, { message: "View not found" });
      requireSiteTable(principal, tableId, command === "deleteView" ? "delete" : "read");
      const [table] = await tx.select().from(tables).where(and(eq(tables.id, tableId), eq(tables.organizationId, principal.organizationId)));
      if (!table) throw new ServiceError(404, { message: "Table not found" });
      const scoped = { ...deps, workspaceId: table.workspaceId }, identity = { organizationId: principal.organizationId };
      if (command === "listViews") return listViews(scoped, { tableId, ...identity }, tx);
      if (command === "deleteView") return deleteView(scoped, { viewId: view!.id, ...identity }, tx);
      return view!.type === "site" ? siteViewDetail(scoped, { kind: "key", secret: context.secret }, view!, tx) : getView(scoped, { viewId: view!.id, ...identity }, tx);
    });
    return { ok: true, command, result };
  }
  if (command === "queryCalendarView") return { ok: true, command, result: await siteQueryCalendarView(deps, context, args) };
  if (command === "updateAutomation") return { ok: true, command, result: await updateScheduledAutomation(deps, context.secret, args) };
  if (isCalendarCommand(command)) return { ok: true, command, result: await executeCalendar(deps, { kind: "key", secret: context.secret }, command, calendarTransportInput(command, args, idempotencyKey)) };
  if (![...tableReadCommands, "addRow", "updateCell", "updateCells", "deleteRow"].includes(command)) throw new ServiceError(403, { message: "API keys only authorize table record CRUD" });
  let result: unknown;
  if (command === "listTables") result = await data.siteTables(deps, context);
  else {
    const tableId = args.tableId === undefined ? await locate(args.rowId) : z.uuid().parse(args.tableId);
    switch (command) {
      case "getTable": result = await data.siteTable(deps, context, tableId); break;
      case "queryRows": { const { tableId: _, ...options } = args; result = await data.siteRows(deps, context, tableId, options); break; }
      case "getRow": result = await data.siteRow(deps, context, tableId, z.uuid().parse(args.rowId), { includeBody: args.includeBody === true, bodyFormat: args.bodyFormat as "json" | "html" }); break;
      case "addRow": result = await data.siteCreateRow(deps, context, tableId, args.cells, args); break;
      case "updateCell": case "updateCells": result = await data.siteUpdateRow(deps, context, tableId, z.uuid().parse(args.rowId), command === "updateCell" ? { [z.uuid().parse(args.columnId)]: args.value } : args.cells, args.expectedVersion as number | undefined, args); break;
      case "deleteRow": result = await data.siteDeleteRow(deps, context, tableId, z.uuid().parse(args.rowId)); break;
      default: throw new ServiceError(403, { message: "API keys only authorize table record CRUD" });
    }
  }
  return { ok: true, command, result };
}
