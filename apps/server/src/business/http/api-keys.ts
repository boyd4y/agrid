import { createRequestRoute, type RequestScopeResolver } from "./request.js";
import * as service from "../services/api-keys.js";

export function createApiKeysRoute(acquire: RequestScopeResolver) {
  const route = createRequestRoute(acquire);
  route.use("*", async (c, next) => {
    const actor = c.get("resolvedActor");
    if (!actor?.organizationId) return c.json({ error: "请登录并选择工作区" }, 401);
    if (actor.kind !== "human") return c.json({ error: "仅用户可管理个人 API Key" }, 403);
    c.set("actor", actor); c.header("Cache-Control", "private, no-store"); await next();
  });
  route.get("/", async c => c.json(await service.listApiKeys(c.get("resources").commands, c.get("actor"))));
  route.post("/", async c => c.json(await service.createApiKey(c.get("resources").commands, c.get("actor"), await c.req.json().catch(() => null)), 201));
  route.delete("/:id", async c => c.json(await service.deleteApiKey(c.get("resources").commands, c.get("actor"), c.req.param("id"))));
  return route;
}
