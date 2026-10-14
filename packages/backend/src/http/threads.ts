import { z } from "zod";
import { createRequestRoute, type BackendScopeResolver } from "./request.js";
import * as service from "../services/threads.js";
import { loadMessages, requireThread } from "../chat/store.js";
import { listNativeRuns, listNativeRunEvents, requestRunCancellation } from "../agent/runs.js";
import { ServiceError } from "../errors.js";

export function createThreadsRoute(acquire: BackendScopeResolver) {
  const route = createRequestRoute(acquire);
  route.use("*", async (c, next) => {
    const actor = c.get("resolvedActor");
    if (!actor?.organizationId) return c.json({ error: "未授权" }, 401);
    c.set("actor", actor); await next();
  });
  const id = (value: string) => z.uuid().parse(value);
  route.get("/", async c => c.json(await service.listThreads(c.get("resources").commands, c.get("actor"), c.req.query("after"))));
  route.post("/", async c => c.json(await service.createThread(c.get("resources").commands, c.get("actor"), await c.req.json()), 201));
  route.get("/:id", async c => c.json(await service.getThread(c.get("resources").commands, c.get("actor"), c.req.param("id"))));
  route.patch("/:id", async c => c.json(await service.updateThread(c.get("resources").commands, c.get("actor"), c.req.param("id"), await c.req.json())));
  route.delete("/:id", async c => {
    const scope = c.get("resources");
    if (!scope.discardRuntime) throw new ServiceError(503, { message: "执行资源清理服务未配置" });
    const cleanup = await service.deleteThread(scope.commands, c.get("actor"), c.req.param("id"));
    await Promise.all(cleanup.map(resource => scope.discardRuntime!(resource.runtimeId, resource.executionIds).catch(error => scope.logger?.error("agent.question.discard", error))));
    return c.json({ ok: true });
  });
  route.post("/:id/title", async c => c.json(await service.setThreadTitle(c.get("resources").commands, c.get("actor"), c.req.param("id"), await c.req.json())));
  route.get("/:id/messages", async c => c.json(await loadMessages(c.get("resources").commands, id(c.req.param("id")), c.get("actor"))));
  route.get("/:id/runs", async c => c.json({ runs: await listNativeRuns(c.get("resources").commands, id(c.req.param("id")), c.get("actor")) }));
  route.get("/:id/runs/:runId/events", async c => c.json({ events: await listNativeRunEvents(c.get("resources").commands, id(c.req.param("id")), id(c.req.param("runId")), c.get("actor")) }));
  route.post("/:id/runs/:runId/cancel", async c => c.json(await requestRunCancellation(c.get("resources").commands, id(c.req.param("id")), id(c.req.param("runId")), c.get("actor"))));
  route.post("/:id/messages", async c => {
    await requireThread(c.get("resources").commands, id(c.req.param("id")), c.get("actor"));
    return c.json({ ok: true });
  });
  return route;
}
