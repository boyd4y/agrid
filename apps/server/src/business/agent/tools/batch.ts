import type { Transaction } from "../../db/types.js";
import type { CommandDependencies } from "../../dependencies.js";
import { BATCH_TOOLS, batchToolResult } from "@tabdo/shared";
import { tool, zodSchema, type ToolSet } from "ai";
import { z } from "zod";
import * as commands from "../../commands/index.js";

export function createBatchTools(deps: CommandDependencies | (() => CommandDependencies), defaultTableId?: string, organizationId?: string, actorId?: string, transaction?: Transaction | (() => Transaction | undefined)): ToolSet {
  const dependencies = () => typeof deps === "function" ? deps() : deps;
  const currentTransaction = () => typeof transaction === "function" ? transaction() : transaction;
  // The only tool convenience is resolving the current table; commands remain canonical.
  return Object.fromEntries(Object.entries(BATCH_TOOLS).map(([name, definition]) => {
    const hasTable = "tableId" in definition.schema.shape;
    const schema = hasTable ? definition.schema.extend({ tableId: z.string().uuid().optional() }) : definition.schema;
    return [name, tool({
      description: definition.description,
      inputSchema: zodSchema<Record<string, unknown>>(schema as z.ZodType<Record<string, unknown>>),
      execute: async (input) => {
        const resolved = hasTable ? { ...input, tableId: (input as { tableId?: string }).tableId ?? defaultTableId } : input;
        const validated = definition.schema.parse(resolved);
        const command = commands[definition.command] as (deps: CommandDependencies, input: typeof validated & { organizationId?: string; actorId?: string }, transaction?: Transaction) => Promise<unknown>;
        return batchToolResult(name, await command(dependencies(), { ...validated, organizationId, actorId }, currentTransaction()));
      },
    })];
  }));
}
