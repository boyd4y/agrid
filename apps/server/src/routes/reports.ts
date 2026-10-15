import { createReportsRoute } from "../business/http/reports.js";
import { acquireRequestScope } from "../services/http-scope.js";
export const reportsRoute = createReportsRoute(acquireRequestScope);
export { reportConfigSchema } from "../business/reports/schema.js";
import { reportErrorResponse as sharedErrorResponse } from "../business/http/reports.js";
import type { Context } from "hono";
export function reportErrorResponse(error: Error, context: Context) {
  return sharedErrorResponse(error, context, { error: (event, error) => console.error(event, error) });
}
