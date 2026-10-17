import { CalendarError } from "../../calendar/errors.js";
import { tool, zodSchema, type ToolSet } from "ai";
import { CALENDAR_TOOLS, CALENDAR_SCHEMAS } from "@tabdo/shared";
import { executeCalendar } from "../../calendar/service.js";
import type { CommandDependencies } from "../../dependencies.js";
import type { Transaction } from "../../db/types.js";

export function createCalendarTools(deps: CommandDependencies | (() => CommandDependencies), organizationId?: string, actorId?: string, transaction?: Transaction | (() => Transaction | undefined)): ToolSet {
  return Object.fromEntries(Object.entries(CALENDAR_TOOLS).map(([id, definition]) => [id, tool({
    description: definition.description,
    inputSchema: zodSchema<Record<string, unknown>>(CALENDAR_SCHEMAS[definition.command]),
    execute: async input => {
      if (!organizationId || !actorId) throw new Error("Current workspace membership is required");
      try { return await executeCalendar(typeof deps === "function" ? deps() : deps, { kind: "member", organizationId, actorId }, definition.command, input, typeof transaction === "function" ? transaction() : transaction); }
      catch (error) { if (error instanceof CalendarError) return { ok: false, error: { code: error.code, message: error.message } }; throw error; }
    },
  })]));
}
