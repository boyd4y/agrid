import { ServiceError } from "../errors.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import * as cmds from "../commands/index.js";
import { createRequestRoute, requireActorOrg, type BackendScopeResolver } from "./request.js";
export function createRowsRoute(acquire: BackendScopeResolver) {
const rowsRoute = createRequestRoute(acquire);

const cellValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

const filterSchema = z.object({
  id: z.string(),
  columnId: z.string().uuid(),
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
  value: cellValueSchema.optional(),
});

/** Windowed keyset page: GET /api/tables/:id/rows?cursor=&limit=&includeTotal=1 */
rowsRoute.get("/tables/:id/rows", async (c) => {
  const scope = await requireActorOrg(c);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const tableId = c.req.param("id");
  const cursor = c.req.query("cursor") || null;
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  const includeTotal =
    c.req.query("includeTotal") === "1" || c.req.query("includeTotal") === "true";
  const statusColumnId = c.req.query("statusColumnId") || undefined;
  const statusValueRaw = c.req.query("statusValue");
  const statusValue =
    statusValueRaw === undefined
      ? undefined
      : statusValueRaw === "" || statusValueRaw === "__none__"
        ? null
        : statusValueRaw;
  const sortColumnId = c.req.query("sortColumnId") || undefined;
  const sortDirection = (c.req.query("sortDirection") as "asc" | "desc") || "asc";
  const filterLogic = (c.req.query("filterLogic") as "and" | "or") || "and";

  let filters: z.infer<typeof filterSchema>[] | undefined;
  const filtersRaw = c.req.query("filters");
  if (filtersRaw) {
    try {
      filters = z.array(filterSchema).parse(JSON.parse(filtersRaw));
    } catch {
      return c.json({ error: "filters 参数无效" }, 400);
    }
  }

  try {
    const page = await cmds.queryRows(c.get("resources").commands, {
      tableId,
      cursor,
      limit,
      includeTotal,
      statusColumnId,
      statusValue,
      filterLogic,
      filters: filters as never,
      sort: sortColumnId
        ? { columnId: sortColumnId, direction: sortDirection }
        : null,
      organizationId: scope.organizationId,
    });
    return c.json(page);
  } catch (e) {
    if (e instanceof ServiceError) return c.json({ error: e.message }, e.status as ContentfulStatusCode);
    return c.json({ error: e instanceof Error ? e.message : "失败" }, 400);
  }
});

/** POST body variant for complex filters (preferred by UI) */
rowsRoute.post("/tables/:id/rows/query", async (c) => {
  const scope = await requireActorOrg(c);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const tableId = c.req.param("id");
  const body = z
    .object({
      cursor: z.string().nullable().optional(),
      limit: z.number().int().positive().optional(),
      includeTotal: z.boolean().optional(),
      filters: z.array(filterSchema).optional(),
      filterLogic: z.enum(["and", "or"]).optional(),
      sort: z
        .object({
          columnId: z.string().uuid(),
          direction: z.enum(["asc", "desc"]),
        })
        .nullable()
        .optional(),
      statusColumnId: z.string().uuid().optional(),
      statusValue: z.string().nullable().optional(),
    })
    .parse(await c.req.json().catch(() => ({})));

  try {
    const page = await cmds.queryRows(c.get("resources").commands, {
      tableId,
      cursor: body.cursor ?? null,
      limit: body.limit,
      includeTotal: body.includeTotal ?? false,
      filters: body.filters as never,
      filterLogic: body.filterLogic,
      sort: body.sort ?? null,
      statusColumnId: body.statusColumnId,
      statusValue: body.statusValue,
      organizationId: scope.organizationId,
    });
    return c.json(page);
  } catch (e) {
    if (e instanceof ServiceError) return c.json({ error: e.message }, e.status as ContentfulStatusCode);
    return c.json({ error: e instanceof Error ? e.message : "失败" }, 400);
  }
});

rowsRoute.post("/tables/:id/rows", async (c) => {
  const scope = await requireActorOrg(c);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const tableId = c.req.param("id");
  const body = z
    .object({ cells: z.record(z.string(), cellValueSchema).optional() })
    .parse(await c.req.json().catch(() => ({})));
  try {
    const row = await cmds.addRow(c.get("resources").commands, { tableId, cells: body.cells, actorId: scope.actor.userId, organizationId: scope.organizationId });
    return c.json(row, 201);
  } catch (e) {
    if (e instanceof ServiceError) return c.json({ error: e.message }, e.status as ContentfulStatusCode);
    return c.json({ error: e instanceof Error ? e.message : "失败" }, 404);
  }
});

rowsRoute.patch("/rows/:id", async (c) => {
  const scope = await requireActorOrg(c);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const id = c.req.param("id");
  const body = z
    .object({
      cells: z.record(z.string(), cellValueSchema).optional(),
      cell: z
        .object({ columnId: z.string().uuid(), value: cellValueSchema })
        .optional(),
      expectedVersion: z.number().int().optional(),
    })
    .parse(await c.req.json());

  try {
    if (body.cell) {
      return c.json(
        await cmds.updateCell(c.get("resources").commands, {
          rowId: id,
          columnId: body.cell.columnId,
          value: body.cell.value,
          expectedVersion: body.expectedVersion,
          actorId: scope.actor.userId,
          organizationId: scope.organizationId,
        })
      );
    }
    if (body.cells) {
      return c.json(
        await cmds.updateCells(c.get("resources").commands, {
          rowId: id,
          cells: body.cells,
          expectedVersion: body.expectedVersion,
          actorId: scope.actor.userId,
          organizationId: scope.organizationId,
        })
      );
    }
    return c.json({ error: "无更新内容" }, 400);
  } catch (e) {
    if (e instanceof ServiceError) return c.json({ error: e.message }, e.status as ContentfulStatusCode);
    const msg = e instanceof Error ? e.message : "失败";
    const status = msg.includes("版本冲突") ? 409 : 404;
    return c.json({ error: msg }, status);
  }
});

rowsRoute.delete("/rows/:id", async (c) => {
  const scope = await requireActorOrg(c);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  try {
    return c.json(
      await cmds.deleteRow(c.get("resources").commands, {
        rowId: c.req.param("id"),
        organizationId: scope.organizationId,
      })
    );
  } catch (e) {
    if (e instanceof ServiceError) return c.json({ error: e.message }, e.status as ContentfulStatusCode);
    return c.json({ error: e instanceof Error ? e.message : "失败" }, 404);
  }
});

return rowsRoute;
}
