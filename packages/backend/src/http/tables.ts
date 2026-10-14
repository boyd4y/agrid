import { z } from "zod";
import { updateTableMetadata } from "../services/tables.js";
import * as cmds from "../commands/index.js";
import { createRequestRoute, requireActorOrg, type BackendScopeResolver } from "./request.js";

export function createTablesRoute(acquire: BackendScopeResolver) {
const tablesRoute = createRequestRoute(acquire);

tablesRoute.get("/", async (c) => {
  const scope = await requireActorOrg(c);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  return c.json(await cmds.listTables(c.get("resources").commands, { organizationId: scope.organizationId }));
});

tablesRoute.post("/", async (c) => {
  const scope = await requireActorOrg(c);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const organizationId = scope.organizationId;
  const body = z
    .object({
      name: z.string().trim().min(1).max(200),
      description: z.string().optional(),
    })
    .parse(await c.req.json());

  const table = await cmds.createTable(c.get("resources").commands, {
    organizationId,
    name: body.name,
    description: body.description,
  });
  return c.json(table, 201);
});

tablesRoute.get("/:id", async (c) => {
  const scope = await requireActorOrg(c);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const organizationId = scope.organizationId;
  try {
    const full = await cmds.getTable(c.get("resources").commands, {
      tableId: c.req.param("id"),
      organizationId,
    });
    return c.json(full);
  } catch {
    return c.json({ error: "表格不存在" }, 404);
  }
});

tablesRoute.patch("/:id", async (c) => {
  const scope = await requireActorOrg(c);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const organizationId = scope.organizationId;
  const id = c.req.param("id");
  const body = z
    .object({
      name: z.string().trim().min(1).max(200).optional(),
      description: z.string().nullable().optional(),
      icon: z.string().trim().min(1).max(100).nullable().optional(),
      pinned: z.boolean().optional(),
    })
    .parse(await c.req.json());

  const updated = await updateTableMetadata(c.get("resources").commands, organizationId, id, body);

  if (!updated) return c.json({ error: "表格不存在" }, 404);
  return c.json(updated);
});

tablesRoute.delete("/:id", async (c) => {
  const scope = await requireActorOrg(c);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const organizationId = scope.organizationId;
  const id = c.req.param("id");
  try { return c.json(await cmds.deleteTable(c.get("resources").commands, {tableId:id,organizationId})); }
  catch(e) { return c.json({error:e instanceof Error?e.message:"删除失败"},400); }
});

return tablesRoute;
}
