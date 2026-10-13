import { Hono } from "hono";
import { z } from "zod";
import * as crud from "../automation/crud.js";
import { requireActorOrg } from "../tenant/http.js";

export const automationsRoute = new Hono();

automationsRoute.get("/automations", async (c) => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const offset = z.coerce.number().int().min(0).max(1_000_000).parse(c.req.query("offset") ?? 0);
  return c.json(await crud.listWorkspaceAutomations(scope.organizationId, offset));
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

const cellValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

const filterCondition = z.object({
  id: z.string(),
  columnId: z.string(),
  op: z.enum([
    "eq",
    "neq",
    "contains",
    "not_contains",
    "is_empty",
    "is_not_empty",
    "gt",
    "gte",
    "lt",
    "lte",
  ]),
  value: cellValue.optional(),
});

const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("row_created") }),
  z.object({
    type: z.literal("field_changed"),
    columnId: z.string().uuid(),
    toValue: cellValue.optional(),
  }),
  z.object({
    type: z.literal("enter_status"),
    columnId: z.string().uuid(),
    optionId: z.string(),
  }),
]);

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("update_field"),
    columnId: z.string().uuid(),
    value: cellValue,
  }),
  z.object({
    type: z.literal("run_agent"),
    agentUserId: z.string().nullable().optional(),
    prompt: z.string().optional(),
    resultColumnId: z.string().uuid().optional(),
    resultValue: cellValue.optional(),
  }),
]);

automationsRoute.get("/tables/:tableId/automations", async (c) => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  try {
    const list = await crud.listAutomations({
      tableId: c.req.param("tableId"),
      organizationId: scope.organizationId,
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
  const body = z
    .object({
      name: z.string().min(1),
      enabled: z.boolean().optional(),
      trigger: triggerSchema,
      conditions: z.array(filterCondition).optional(),
      conditionLogic: z.enum(["and", "or"]).optional(),
      actions: z.array(actionSchema).min(1),
    })
    .parse(await c.req.json());
  try {
    const rule = await crud.createAutomation({
      tableId,
      ...body,
      organizationId: scope.organizationId,
    });
    return c.json(rule, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "失败" }, 400);
  }
});

automationsRoute.patch("/automations/:id", async (c) => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const body = z
    .object({
      name: z.string().min(1).optional(),
      enabled: z.boolean().optional(),
      trigger: triggerSchema.optional(),
      conditions: z.array(filterCondition).optional(),
      conditionLogic: z.enum(["and", "or"]).optional(),
      actions: z.array(actionSchema).min(1).optional(),
    })
    .parse(await c.req.json());
  try {
    const rule = await crud.updateAutomation({
      automationId: c.req.param("id"),
      ...body,
      organizationId: scope.organizationId,
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
    });
    return c.json(list);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "失败" }, 400);
  }
});
