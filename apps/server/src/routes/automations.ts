import { Hono } from "hono";
import { z } from "zod";
import { AUTOMATION_CREATE_SCHEMA, AUTOMATION_UPDATE_SCHEMA } from "@tabdo/shared";
import { schedulePreview } from "../automation/schedule.js";
import * as crud from "../automation/crud.js";
import { requireActorOrg } from "../tenant/http.js";

export const automationsRoute = new Hono();

automationsRoute.get("/automations", async (c) => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const offset = z.coerce.number().int().min(0).max(1_000_000).parse(c.req.query("offset") ?? 0);
  const limit = z.coerce.number().int().min(1).max(100).parse(c.req.query("limit") ?? 100);
  const kind = z.enum(["event", "schedule"]).optional().parse(c.req.query("kind"));
  return c.json(await crud.listWorkspaceAutomations(scope.organizationId, offset, limit, kind));
});

automationsRoute.get("/automations/:id", async (c) => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  try { return c.json(await crud.getWorkspaceAutomation(z.uuid().parse(c.req.param("id")), scope.organizationId)); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "自动化不存在" }, 404); }
});

automationsRoute.post("/automation-runs/:id/replay", async (c) => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  try { return c.json(await crud.replayAutomationRun(c.req.param("id"), scope.organizationId)); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : "重放失败" }, 400); }
});

automationsRoute.get("/tables/:tableId/automations", async (c) => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  try {
    const list = await crud.listAutomations({
      tableId: c.req.param("tableId"),
      organizationId: scope.organizationId,
      actorId: scope.actor.userId,
    });
    return c.json(list);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "失败" }, 400);
  }
});

automationsRoute.post("/tables/:tableId/automations", async (c) => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const tableId = c.req.param("tableId");
  const body = AUTOMATION_CREATE_SCHEMA.parse(await c.req.json());
  try {
    const rule = await crud.createAutomation({
      ...body,
      tableId,
      organizationId: scope.organizationId,
      actorId: scope.actor.userId,
    });
    return c.json(rule, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "失败" }, 400);
  }
});

automationsRoute.patch("/automations/:id", async (c) => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const body = AUTOMATION_UPDATE_SCHEMA.parse(await c.req.json());
  try {
    const rule = await crud.updateAutomation({
      automationId: c.req.param("id"),
      ...body,
      organizationId: scope.organizationId,
      actorId: scope.actor.userId,
    });
    return c.json(rule);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "失败" }, 400);
  }
});

automationsRoute.delete("/automations/:id", async (c) => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  try {
    return c.json(
      await crud.deleteAutomation({
        automationId: c.req.param("id"),
        organizationId: scope.organizationId,
      })
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "失败" }, 404);
  }
});

automationsRoute.get("/tables/:tableId/automation-runs", async (c) => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const automationId = c.req.query("automationId") || undefined;
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : 50;
  try {
    const list = await crud.listAutomationRuns({
      tableId: c.req.param("tableId"),
      automationId,
      limit,
      organizationId: scope.organizationId,
      actorId: scope.actor.userId,
    });
    return c.json(list);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "失败" }, 400);
  }
});

automationsRoute.post("/automations", async c => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  try { const body = AUTOMATION_CREATE_SCHEMA.parse(await c.req.json());
    return c.json(await crud.createAutomation({ ...body, organizationId: scope.organizationId, actorId: scope.actor.userId }), 201);
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : "创建失败" }, 400); }
});
automationsRoute.get("/automations/:id/runs", async c => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  try { return c.json(await crud.listRuleRuns(z.uuid().parse(c.req.param("id")), scope.organizationId)); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "自动化不存在" }, 404); }
});
automationsRoute.post("/automations/schedule-preview", async c => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  try { const body = z.object({ cron: z.string(), timeZone: z.string() }).strict().parse(await c.req.json());
    return c.json({ occurrences: schedulePreview(body.cron, body.timeZone) }); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "时间计划无效" }, 400); }
});
