import { DocumentError } from "../../documents/errors.js";
import { tool, zodSchema, type ToolSet } from "ai";
import { DOCUMENT_TOOLS, DOCUMENT_SCHEMAS } from "@tabdo/shared";
import { executeDocument } from "../../documents/service.js";
import type { CommandDependencies } from "../../dependencies.js";
import type { Transaction } from "../../db/types.js";

export function createDocumentTools(deps: CommandDependencies | (() => CommandDependencies), organizationId?: string, actorId?: string, transaction?: Transaction | (() => Transaction | undefined)): ToolSet {
  return Object.fromEntries(Object.entries(DOCUMENT_TOOLS).map(([id, definition]) => [id, tool({
    description: definition.description,
    inputSchema: zodSchema<Record<string, unknown>>(DOCUMENT_SCHEMAS[definition.command]),
    execute: async input => {
      if (!organizationId || !actorId) throw new Error("Current workspace membership is required");
      try { return await executeDocument(typeof deps === "function" ? deps() : deps, { kind: "member", organizationId, actorId }, definition.command, input, typeof transaction === "function" ? transaction() : transaction); }
      // executeDocument has already rolled back its command transaction/savepoint here.
      catch (error) { if (error instanceof DocumentError) return { ok: false, error: { code: error.code, message: error.message } }; throw error; }
    },
  })]));
}
