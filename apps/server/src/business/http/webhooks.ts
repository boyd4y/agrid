import { createRequestRoute, type RequestScopeResolver } from "./request.js";
import { integrationActor, integrationDependencies, integrationError } from "./integrations.js";
import * as service from "../services/webhooks.js";

export function createWebhookEndpointsRoute(acquire: RequestScopeResolver) {
  const route = createRequestRoute(acquire);
  route.onError(integrationError);
  route.get("/", async c => c.json(await service.listEndpoints(integrationDependencies(c), integrationActor(c), c.req.raw)));
  route.post("/", async c => c.json(await service.createEndpoint(integrationDependencies(c), integrationActor(c, true), c.req.raw), 201));
  route.patch("/:id", async c => c.json(await service.updateEndpoint(integrationDependencies(c), integrationActor(c, true), c.req.raw, c.req.param("id"))));
  route.delete("/:id", async c => c.json(await service.deleteEndpoint(integrationDependencies(c), integrationActor(c, true), c.req.raw, c.req.param("id"))));
  return route;
}
export function createWebhooksRoute(acquire: RequestScopeResolver) {
  const route = createRequestRoute(acquire);
  route.onError(integrationError);
  route.post("/:id", async c => c.json(await service.receiveWebhook(integrationDependencies(c), c.req.raw, c.req.param("id"))));
  route.post("/agentmail/:id", async c => c.json(await service.receiveAgentMail(integrationDependencies(c), c.req.raw, c.req.param("id"))));
  return route;
}
