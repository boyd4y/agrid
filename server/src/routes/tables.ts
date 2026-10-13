import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { TABLE_ICON_NAMES } from "@tabdo/shared";
import { z } from "zod";
import { db } from "../db/index.js";
import { tables } from "../db/schema.js";
import * as cmds from "../commands/index.js";
import { requireActorOrg } from "../tenant/http.js";

export const tablesRoute = new Hono();

tablesRoute.get("/", async (c) => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  return c.json(await cmds.listTables({ organizationId: scope.organizationId }));
});

tablesRoute.post("/", async (c) => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const organizationId = scope.organizationId;
  const body = z
    .object({
      name: z.string().min(1).max(200),
      description: z.string().optional(),
    })
    .parse(await c.req.json());

  const table = await cmds.createTable({
    organizationId,
    name: body.name,
    description: body.description,
  });
  return c.json(table, 201);
});

tablesRoute.get("/:id", async (c) => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const organizationId = scope.organizationId;
  try {
    const full = await cmds.getTable({
      tableId: c.req.param("id"),
      organizationId,
    });
    return c.json(full);
  } catch {
    return c.json({ error: "表格不存在" }, 404);
  }
});

tablesRoute.patch("/:id", async (c) => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const organizationId = scope.organizationId;
  const id = c.req.param("id");
  const body = z
    .object({
      name: z.string().min(1).max(200).optional(),
      description: z.string().nullable().optional(),
      icon: z.enum(TABLE_ICON_NAMES).nullable().optional(),
      pinned: z.boolean().optional(),
    })
    .parse(await c.req.json());

  const [updated] = await db
    .update(tables)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.icon !== undefined ? { icon: body.icon } : {}),
      ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(tables.id, id), eq(tables.organizationId, organizationId)))
    .returning();

  if (!updated) return c.json({ error: "表格不存在" }, 404);
  return c.json(updated);
});

tablesRoute.delete("/:id", async (c) => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const organizationId = scope.organizationId;
  const id = c.req.param("id");
  try { return c.json(await cmds.deleteTable({tableId:id,organizationId})); }
  catch(e) { return c.json({error:e instanceof Error?e.message:"删除失败"},400); }
});
