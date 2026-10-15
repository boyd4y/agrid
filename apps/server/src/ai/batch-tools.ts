import { createBatchTools as create } from "../business/agent/tools/batch.js";
import { commandDependencies } from "../services/dependencies.js";
import { getToolTransaction } from "./execution-context.js";
export function createBatchTools(defaultTableId?: string, organizationId?: string, actorId?: string) {
  return create(commandDependencies, defaultTableId, organizationId, actorId, getToolTransaction);
}
