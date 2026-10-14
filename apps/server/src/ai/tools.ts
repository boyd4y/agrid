import { createTableTools as create } from "@tabdo/backend/agent/tools/index";
import { commandDependencies } from "../services/backend-facade.js";
import { getToolTransaction } from "./execution-context.js";
export function createTableTools(defaultTableId?: string, organizationId?: string, actorId?: string) {
  return create(commandDependencies, defaultTableId, organizationId, actorId, getToolTransaction);
}
export type TableTools = ReturnType<typeof createTableTools>;
