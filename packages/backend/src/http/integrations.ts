import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Context } from "hono";
import type { BackendEnvironment } from "./request.js";
import { createRequestRoute, type BackendScopeResolver } from "./request.js";
import type { IntegrationDependencies } from "../integrations/dependencies.js";
import { canManageIntegrations } from "../integrations/management.js";
import { ServiceError } from "../errors.js";
import * as service from "../services/integrations.js";

export function integrationDependencies(c: Context<BackendEnvironment>): IntegrationDependencies {
  const scope = c.get("resources");
  if (!scope.integrations) throw new ServiceError(503, { message: "集成服务未配置" });
  return { ...scope.commands, ...scope.integrations };
}
export function integrationActor(c: Context<BackendEnvironment>, manage = false) {
  const actor = c.get("resolvedActor");
  if (!actor?.organizationId) throw new ServiceError(401, { message: "请登录并选择工作区" });
  if (manage && !canManageIntegrations(actor)) throw new ServiceError(403, { message: "仅工作区 owner/admin 可管理集成" });
  c.header("Cache-Control", "private, no-store"); return actor;
}
export function integrationError(error: Error, c: Context<BackendEnvironment>) {
  if (error instanceof ServiceError) return c.json({ error: error.message }, error.status as ContentfulStatusCode);
  c.get("resources")?.logger?.error("integration.request.failed", error.name);
  return c.json({ error: "集成请求失败，请重试" }, 500);
}
export function createIntegrationsRoute(acquire: BackendScopeResolver) {
  const route = createRequestRoute(acquire);
  route.onError(integrationError);
  route.get("/", async c => c.json(await service.listConnections(integrationDependencies(c), integrationActor(c), c.req.raw)));
  route.post("/", async c => c.json(await service.createConnection(integrationDependencies(c), integrationActor(c, true), c.req.raw), 201));
  route.patch("/:id", async c => c.json(await service.updateConnection(integrationDependencies(c), integrationActor(c, true), c.req.raw, c.req.param("id"))));
  route.delete("/:id", async c => c.json(await service.deleteConnection(integrationDependencies(c), integrationActor(c, true), c.req.raw, c.req.param("id"))));
  route.post("/:id/test", async c => c.json(await service.testConnection(integrationDependencies(c), integrationActor(c, true), c.req.raw, c.req.param("id"))));
  route.get("/:id/inboxes", async c => c.json(await service.listInboxes(integrationDependencies(c), integrationActor(c), c.req.raw, c.req.param("id"))));
  route.post("/:id/webhooks", async c => c.json(await service.registerWebhook(integrationDependencies(c), integrationActor(c, true), c.req.raw, c.req.param("id")), 201));
  return route;
}
