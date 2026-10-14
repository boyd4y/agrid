import { relationConfigSchema, rollupConfigSchema } from "../commands/relations.js";
import { ServiceError } from "../errors.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { COLUMN_TYPES } from "../db/schema.js";
import * as cmds from "../commands/index.js";
import { createRequestRoute, requireActorOrg, type BackendScopeResolver } from "./request.js";
import { requireColumnInOrg } from "../tenant/scope.js";

export function createColumnsRoute(acquire: BackendScopeResolver) {
const columnsRoute = createRequestRoute(acquire);

columnsRoute.get("/columns/:id", async (c) => {
  const scope = await requireActorOrg(c);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const id = z.string().uuid().safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "字段标识无效" }, 400);
  try {
    const { column } = await requireColumnInOrg(c.get("resources").commands, id.data, scope.organizationId);
    return c.json(column);
  } catch {
    return c.json({ error: "字段不存在" }, 404);
  }
});

columnsRoute.post("/tables/:id/columns", async (c) => {
  const scope = await requireActorOrg(c);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const tableId = c.req.param("id");
  const body = z
    .object({
      name: z.string().trim().min(1).max(100),
      type: z.enum(COLUMN_TYPES),
      config: z
        .object({
          options: z
            .array(
              z.object({
                id: z.string(),
                label: z.string(),
                color: z.string().optional(),
              })
            )
            .optional(),
          file: z.object({ multiple: z.boolean().optional() }).strict().optional(),
          hidden: z.boolean().optional(),
          relation: relationConfigSchema.extend({relationId:z.string().uuid().optional(),direction:z.enum(["source","target"]).optional(),limit:z.enum(["one","many"]).optional(),inverseLimit:z.enum(["one","many"]).optional()}).optional(),
          rollup: rollupConfigSchema.optional(),
          formula: z.string().optional(), formulaResultType: z.enum(["auto","number","text","checkbox","date"]).optional(), dateFormat:z.string().optional(),
        })
        .optional(),
      width: z.number().int().positive().optional(),
    })
    .parse(await c.req.json());

  try {
    const col = await cmds.addColumn(c.get("resources").commands, {
      tableId,
      name: body.name,
      type: body.type,
      config: body.config as import("@tabdo/shared").ColumnConfig,
      width: body.width,
      organizationId: scope.organizationId,
    });
    return c.json(col, 201);
  } catch (e) {
    if (e instanceof ServiceError) return c.json({ error: e.message }, e.status as ContentfulStatusCode);
    return c.json({ error: e instanceof Error ? e.message : "失败" }, 404);
  }
});

columnsRoute.patch("/columns/:id", async (c) => {
  const scope = await requireActorOrg(c);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const id = c.req.param("id");
  const body = z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      type: z.enum(COLUMN_TYPES).optional(),
      config: z
        .object({
          options: z
            .array(
              z.object({
                id: z.string(),
                label: z.string(),
                color: z.string().optional(),
              })
            )
            .optional(),
          file: z.object({ multiple: z.boolean().optional() }).strict().optional(),
          hidden: z.boolean().optional(),
          relation: relationConfigSchema.extend({relationId:z.string().uuid().optional(),direction:z.enum(["source","target"]).optional(),limit:z.enum(["one","many"]).optional(),inverseLimit:z.enum(["one","many"]).optional()}).optional(),
          rollup: rollupConfigSchema.optional(),
          formula: z.string().optional(), formulaResultType: z.enum(["auto","number","text","checkbox","date"]).optional(), dateFormat:z.string().optional(),
        })
        .optional(),
      width: z.number().int().positive().optional(),
      sortOrder: z.number().int().optional(),
      hidden: z.boolean().optional(),
    })
    .parse(await c.req.json());

  try {
    const updated = await cmds.updateColumn(c.get("resources").commands, {
      columnId: id,
      name: body.name,
      type: body.type,
      config: body.config as import("@tabdo/shared").ColumnConfig,
      width: body.width,
      sortOrder: body.sortOrder,
      hidden: body.hidden,
      organizationId: scope.organizationId,
    });
    return c.json(updated);
  } catch (e) {
    if (e instanceof ServiceError) return c.json({ error: e.message }, e.status as ContentfulStatusCode);
    return c.json({ error: e instanceof Error ? e.message : "失败" }, 404);
  }
});

columnsRoute.delete("/columns/:id", async (c) => {
  const scope = await requireActorOrg(c);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  try {
    return c.json(
      await cmds.deleteColumn(c.get("resources").commands, {
        columnId: c.req.param("id"),
        organizationId: scope.organizationId,
      })
    );
  } catch (e) {
    if (e instanceof ServiceError) return c.json({ error: e.message }, e.status as ContentfulStatusCode);
    return c.json({ error: e instanceof Error ? e.message : "失败" }, 404);
  }
});

return columnsRoute;
}
