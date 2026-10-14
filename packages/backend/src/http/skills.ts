import { createRequestRoute, requireActorOrg, type BackendScopeResolver, type BackendEnvironment } from "./request.js";
import { z } from "zod";
import { SkillError } from "../skills/document.js";
import * as service from "../skills/service.js";

export function createSkillsRoute(acquire: BackendScopeResolver) {
const skillsRoute = createRequestRoute(acquire);
skillsRoute.use("*", async (c, next) => {
  const actor = c.get("resolvedActor");
  if (!actor?.organizationId) return c.json({ error: "请登录并选择工作区" }, 401);
  c.set("actor", actor);
  if (c.req.method !== "GET" && !["owner", "admin"].includes(actor.role)) return c.json({ error: "仅工作区管理员可管理技能" }, 403);
  await next();
});
skillsRoute.onError((error, c) => {
  if (error instanceof SkillError) return c.json({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return c.json({ error: "技能参数无效" }, 400);
  c.get("resources")?.logger?.error("skills.request", error);
  return c.json({ error: "技能暂时无法加载，请稍后重试" }, 500);
});
const skillDeps = (c: import("hono").Context<BackendEnvironment>): service.SkillDependencies => {
  const scope = c.get("resources");
  if (!scope.builtinSkills) throw new SkillError("内置技能目录未配置");
  return { ...scope.commands, builtins: scope.builtinSkills };
};
const idSchema = z.union([z.uuid(), z.string().regex(/^builtin:[a-z0-9-]+$/)]);
const documentSchema = z.string().min(1).max(64_000);
const filesSchema = z.array(z.strictObject({ path: z.string().min(1).max(240), content: z.string().max(128_000) })).max(80);
skillsRoute.get("/", async (c) => {
  const actor = c.get("actor");
  const skills = (await service.listSkills(skillDeps(c), actor.organizationId)).map(({ document, content, files, ...summary }) => ({ ...summary, fileCount: 1 + files.length }));
  return c.json({ skills, canManage: ["owner", "admin"].includes(actor.role) });
});
// The platform catalogue is managed in source control. Custom skill creation is not open yet.
skillsRoute.post("/", (c) => c.json({ error: "暂不支持新增技能" }, 405));
skillsRoute.get("/:id", async (c) => c.json(await service.getSkill(skillDeps(c), c.get("actor").organizationId, idSchema.parse(c.req.param("id")))));
skillsRoute.patch("/:id", async (c) => {
  const { document, expectedVersion, files } = z.strictObject({ document: documentSchema, files: filesSchema.optional(), expectedVersion: z.number().int().positive() }).parse(await c.req.json());
  return c.json(await service.updateSkill(skillDeps(c), c.get("actor").organizationId, idSchema.parse(c.req.param("id")), document, expectedVersion, files));
});
skillsRoute.put("/:id/enabled", async (c) => {
  const { enabled } = z.strictObject({ enabled: z.boolean() }).parse(await c.req.json());
  return c.json(await service.setSkillEnabled(skillDeps(c), c.get("actor").organizationId, idSchema.parse(c.req.param("id")), enabled));
});
skillsRoute.delete("/:id", async (c) => c.json(await service.deleteSkill(skillDeps(c), c.get("actor").organizationId, idSchema.parse(c.req.param("id")))));

return skillsRoute;
}
