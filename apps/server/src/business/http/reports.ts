import { createRequestRoute, requireActorOrg, type RequestScopeResolver, type RequestEnvironment } from "./request.js";
import type { Context } from "hono";
import { z } from "zod";

import * as service from "../reports/service.js";
import { reportConfigSchema, reportPageSchema } from "../reports/schema.js";
export { reportConfigSchema } from "../reports/schema.js";
type Env = RequestEnvironment;
export function reportErrorResponse(error: Error, c: Context, logger?: Readonly<{ error(event: string, error: unknown): void }>) {
  if (error instanceof z.ZodError) return c.json({ error: "报告参数错误" }, 400);
  if (error instanceof service.ReportError) return c.json({ error: error.message }, error.status);
  (c.get("resources")?.logger ?? logger)?.error("reports.request", error);
  return c.json({ error: "报告暂时无法加载，请稍后重试" }, 500);
}
export function createReportsRoute(acquire: RequestScopeResolver) {
const reportsRoute = createRequestRoute(acquire);
reportsRoute.use("*", async (c, next) => { const scope = await requireActorOrg(c); if (!scope.ok) return c.json({ error: scope.error }, scope.status); c.set("actor", scope.actor); await next(); });

reportsRoute.onError(reportErrorResponse);
const org = (c: Context<Env>) => c.get("actor").organizationId;
reportsRoute.get("/", async (c) => {
  const offset = z.coerce.number().int().min(0).max(1_000_000).parse(c.req.query("offset") ?? 0);
  const limit = z.coerce.number().int().min(1).max(100).parse(c.req.query("limit") ?? 100);
  return c.json(await service.listReports(c.get("resources").commands, org(c), offset, limit));
});
reportsRoute.post("/", async (c) => c.json(await service.saveReport(c.get("resources").commands, z.union([reportPageSchema, reportConfigSchema]).parse(await c.req.json()), org(c)), 201));
reportsRoute.post("/preview", async (c) => c.json(await service.queryReport(c.get("resources").commands, reportConfigSchema.parse(await c.req.json()), org(c))));
reportsRoute.post("/preview-page", async (c) => c.json(await service.queryReportPage(c.get("resources").commands, reportPageSchema.parse(await c.req.json()), org(c))));
reportsRoute.get("/:id", async (c) => c.json(await service.getReport(c.get("resources").commands, z.uuid().parse(c.req.param("id")), org(c))));
reportsRoute.get("/:id/data", async (c) => { const { name, description, columns, widgets } = await service.getReport(c.get("resources").commands, z.uuid().parse(c.req.param("id")), org(c)); return c.json(await service.queryReportPage(c.get("resources").commands, { name, description, columns, widgets }, org(c))); });
reportsRoute.patch("/:id", async (c) => {
  const { expectedVersion, ...input } = z.strictObject({ ...reportPageSchema.shape, expectedVersion: z.number().int().positive() }).parse(await c.req.json());
  return c.json(await service.saveReport(c.get("resources").commands, reportPageSchema.parse(input), org(c), z.uuid().parse(c.req.param("id")), expectedVersion));
});
reportsRoute.delete("/:id", async (c) => c.json(await service.deleteReport(c.get("resources").commands, z.uuid().parse(c.req.param("id")), org(c))));

return reportsRoute;
}
