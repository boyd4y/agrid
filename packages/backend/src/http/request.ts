import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { resolveActor, type Actor, type ActorDependencies } from "../auth/actor.js";
import type { CommandDependencies } from "../dependencies.js";
import type { AgentToolCatalog, SkillDocument } from "@tabdo/shared";
import type { IntegrationCapabilities } from "../integrations/dependencies.js";
import type { FileCapabilities } from "../services/files.js";
import { ServiceError } from "../errors.js";

/** Deployment-owned resources and capabilities, captured once for this request. */
export type BackendRequestScope = Readonly<{
  commands: CommandDependencies;
  files?: FileCapabilities;
  integrations?: IntegrationCapabilities;
  identity: ActorDependencies;
  builtinSkills?: readonly SkillDocument[];
  toolCatalog?(harness: "pi" | "codex" | "claude"): AgentToolCatalog;
  invite?(actor: Actor, input: { email: string; role: "admin" | "member" }, headers: Headers): Promise<unknown>;
  discardRuntime?(runtimeId: string, executionIds?: readonly string[]): Promise<void>;
  logger?: Readonly<{ error(event: string, error: unknown): void }>;
  close(): Promise<void>;
}>;
export type BackendScopeResolver = (request: Request) => Promise<BackendRequestScope>;
export type BackendEnvironment = { Variables: { resources: BackendRequestScope; resourceResolver: BackendScopeResolver; resolvedActor: Actor | null; actor: Actor } };

/** Web-only transport lifetime. Business services never import this module. */
export function createRequestRoute(acquire: BackendScopeResolver) {
  const route = new Hono<BackendEnvironment>();
  route.use("*", async (c, next) => {
    // Routes mounted at /api may have overlapping middleware prefixes. Share
    // resources only when their explicit resolver is the same function.
    if (c.get("resourceResolver") === acquire && c.get("resources")) return next();
    const scope = await acquire(c.req.raw);
    c.set("resourceResolver", acquire);
    c.set("resources", scope);
    try {
      c.set("resolvedActor", await resolveActor(c.req.raw, scope.identity));
      await next();
    } finally { await scope.close(); }
  });
  route.onError((error, c) => {
    if (error instanceof ServiceError) return c.json({ error: error.message }, error.status as ContentfulStatusCode);
    if (error.name === "ZodError") return c.json({ error: "参数错误", details: error }, 400);
    c.get("resources")?.logger?.error("http.request", error);
    return c.json({ error: error.message || "服务器错误" }, error.message.includes("版本冲突") ? 409 : 500);
  });
  return route;
}
export function requireActorOrg(c: Context<BackendEnvironment>) {
  const actor = c.get("resolvedActor");
  const organizationId = actor?.organizationId?.trim() || "";
  if (!actor || !organizationId) return { ok: false as const, status: 401 as const, error: "缺少组织上下文：请先登录并选择工作区" };
  return { ok: true as const, actor, organizationId };
}
