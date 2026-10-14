import { createReportsRoute } from "@tabdo/backend/http/reports";
import { acquireNodeBackendScope } from "../services/http-scope.js";
export const reportsRoute = createReportsRoute(acquireNodeBackendScope);
export { reportConfigSchema } from "@tabdo/backend/reports/schema";
import { reportErrorResponse as sharedErrorResponse } from "@tabdo/backend/http/reports";
import type { Context } from "hono";
export function reportErrorResponse(error: Error, context: Context) {
  return sharedErrorResponse(error, context, { error: (event, error) => console.error(event, error) });
}
