import { createBatchTools as create } from "@tabdo/backend/agent/tools/batch";
import { commandDependencies } from "../services/backend-facade.js";
import { getToolTransaction } from "./execution-context.js";
export function createBatchTools(defaultTableId?: string, organizationId?: string, actorId?: string) {
  return create(commandDependencies, defaultTableId, organizationId, actorId, getToolTransaction);
}
