import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { CommandDependencies } from "../dependencies.js";
import { rows, tables } from "../db/schema.js";
import { ServiceError } from "../errors.js";
import * as data from "./data.js";
import { siteQueryCalendarView } from "./calendar-views.js";
import { isBlogCommand, blogTransportInput } from "../blogs/transport.js";
import { executeBlog } from "../blogs/service.js";
import { isDocumentCommand, documentTransportInput } from "../documents/transport.js";
import { executeDocument } from "../documents/service.js";
import { isCalendarCommand, calendarTransportInput } from "../calendar/transport.js";
import { executeCalendar } from "../calendar/service.js";
import { updateScheduledAutomation } from "../calendar/schedules.js";

/** The same capability command boundary for REST and remote MCP. */
export async function dispatchKeyCommand(deps: CommandDependencies, context: data.SiteContext, body: Record<string, unknown>, idempotencyKey?: string) {
  const locate = async (rowId: unknown) => {
    const id = z.uuid().parse(rowId);
    const [found] = await deps.database.select({ tableId: rows.tableId }).from(rows).innerJoin(tables, eq(tables.id, rows.tableId))
      .where(and(eq(rows.id, id), eq(tables.organizationId, context.principal.organizationId)));
    if (!found) throw new ServiceError(404, { message: "Record not found" }); return found.tableId;
  };
  const command = z.string().parse(body.command), args = z.record(z.string(), z.unknown()).parse(body.input ?? {});
  if (["workspaceId", "organizationId", "actorId", "skipAutomation"].some(key => Object.hasOwn(args, key))) throw new ServiceError(400, { message: "Internal execution options cannot be supplied" });
  if (command === "queryCalendarView") return { ok: true, command, result: await siteQueryCalendarView(deps, context, args) };
  if (isBlogCommand(command)) return { ok: true, command, result: await executeBlog(deps, { kind: "key", secret: context.secret }, command, blogTransportInput(command, args, idempotencyKey)) };
  if (command === "updateAutomation") return { ok: true, command, result: await updateScheduledAutomation(deps, context.secret, args) };
  if (isDocumentCommand(command)) return { ok: true, command, result: await executeDocument(deps, { kind: "key", secret: context.secret }, command, documentTransportInput(command, args, idempotencyKey)) };
  if (isCalendarCommand(command)) return { ok: true, command, result: await executeCalendar(deps, { kind: "key", secret: context.secret }, command, calendarTransportInput(command, args, idempotencyKey)) };
  if (!["listTables", "getTable", "queryRows", "getRow", "addRow", "updateCell", "updateCells", "deleteRow"].includes(command)) throw new ServiceError(403, { message: "API keys only authorize table record CRUD" });
  let result: unknown;
  if (command === "listTables") result = await data.siteTables(deps, context);
  else {
    const tableId = args.tableId === undefined ? await locate(args.rowId) : z.uuid().parse(args.tableId);
    switch (command) {
      case "getTable": result = await data.siteTable(deps, context, tableId); break;
      case "queryRows": { const { tableId: _, ...options } = args; result = await data.siteRows(deps, context, tableId, options); break; }
      case "getRow": result = await data.siteRow(deps, context, tableId, z.uuid().parse(args.rowId)); break;
      case "addRow": result = await data.siteCreateRow(deps, context, tableId, args.cells); break;
      case "updateCell": case "updateCells": result = await data.siteUpdateRow(deps, context, tableId, z.uuid().parse(args.rowId), command === "updateCell" ? { [z.uuid().parse(args.columnId)]: args.value } : args.cells, args.expectedVersion as number | undefined); break;
      case "deleteRow": result = await data.siteDeleteRow(deps, context, tableId, z.uuid().parse(args.rowId)); break;
      default: throw new ServiceError(403, { message: "API keys only authorize table record CRUD" });
    }
  }
  return { ok: true, command, result };
}
