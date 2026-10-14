import { createReportTools as create } from "@tabdo/backend/agent/tools/report";
import { runtimeDependencies } from "../services/backend-facade.js";
import { getToolTransaction } from "./execution-context.js";
export function createReportTools(organizationId?: string) {
  return create(runtimeDependencies, organizationId, getToolTransaction);
}
