import { createReportTools as create } from "../business/agent/tools/report.js";
import { runtimeDependencies } from "../services/dependencies.js";
import { getToolTransaction } from "./execution-context.js";
export function createReportTools(organizationId?: string) {
  return create(runtimeDependencies, organizationId, getToolTransaction);
}
