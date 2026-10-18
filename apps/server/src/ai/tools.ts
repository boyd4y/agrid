import { createTableTools as create } from "../business/agent/tools/index.js";
import { integrationCapabilities } from "../integrations/dependencies.js";
import { commandDependencies } from "../services/dependencies.js";
import { getToolTransaction } from "./execution-context.js";
export function createTableTools(defaultTableId?: string, organizationId?: string, actorId?: string, workspaceId?: string) {
  return create(() => ({ ...commandDependencies(), integrations: integrationCapabilities(), workspaceId }), defaultTableId, organizationId, actorId, getToolTransaction);
}
export type TableTools = ReturnType<typeof createTableTools>;
