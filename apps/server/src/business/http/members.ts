import { createRequestRoute, type RequestScopeResolver } from "./request.js";
import * as service from "../services/members.js";
import type { Context } from "hono";
import type { RequestEnvironment } from "./request.js";

export function createMembersRoute(acquire: RequestScopeResolver) {
  const route = createRequestRoute(acquire);
  route.use("*", async (c, next) => {
    const actor = c.get("resolvedActor");
    if (!actor) return c.json({ error: "未授权" }, 401);
    c.set("actor", actor); await next();
  });
  const deps = (c: Context<RequestEnvironment>): service.MemberDependencies => ({
    ...c.get("resources").commands, builtinSkills: c.get("resources").builtinSkills,
    toolCatalog: c.get("resources").toolCatalog, invite: c.get("resources").invite, logger: c.get("resources").logger,
  });
  route.get("/agents/tools", async c => c.json(await service.getToolCatalog(deps(c), c.get("actor"), c.req.query("harness"))));
  route.get("/", async c => c.json(await service.listMembers(deps(c), c.get("actor"))));
  route.post("/invite", async c => c.json(await service.inviteMember(deps(c), c.get("actor"), await c.req.json(), c.req.raw.headers)));
  route.post("/agents", async c => c.json(await service.createAgent(deps(c), c.get("actor"), await c.req.json()), 201));
  route.patch("/agents/:memberId", async c => c.json(await service.updateAgent(deps(c), c.get("actor"), await c.req.json(), c.req.param("memberId"))));
  route.get("/:memberId/avatar", async c => {
    const avatar = await service.getMemberAvatar(deps(c), c.get("actor"), c.req.param("memberId"));
    return new Response(avatar.bytes, { headers: { "Content-Type": avatar.mimeType, "Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff" } });
  });
  route.patch("/:memberId/avatar", async c => c.json(await service.updateMemberAvatar(deps(c), c.get("actor"), await c.req.json(), c.req.param("memberId"))));
  route.delete("/:memberId", async c => c.json(await service.deleteMember(deps(c), c.get("actor"), c.req.param("memberId"))));
  route.get("/me", async c => c.json(await service.getMe(deps(c), c.get("actor"))));
  return route;
}
