import { tool, zodSchema, type ToolSet } from "ai";
import { BLOG_TOOLS, BLOG_SCHEMAS } from "@tabdo/shared";
import { executeBlog } from "../../blogs/service.js";
import { BlogError } from "../../blogs/errors.js";
import type { CommandDependencies } from "../../dependencies.js";
import type { Transaction } from "../../db/types.js";
export function createBlogTools(source: CommandDependencies | (() => CommandDependencies), organizationId?: string, actorId?: string, transaction?: Transaction | (() => Transaction | undefined)): ToolSet {
  return Object.fromEntries(Object.entries(BLOG_TOOLS).map(([id, definition]) => [id, tool({
    description: definition.description, inputSchema: zodSchema<Record<string, unknown>>(BLOG_SCHEMAS[definition.command]),
    execute: async input => {
      if (!organizationId || !actorId) throw new Error("Current workspace membership is required");
      try { return await executeBlog(typeof source === "function" ? source() : source, { kind: "native", organizationId, actorId }, definition.command, input, typeof transaction === "function" ? transaction() : transaction); }
      catch (error) { if (error instanceof BlogError) return { ok: false, error: { code: error.code, message: error.message } }; throw error; }
    },
  })]));
}
