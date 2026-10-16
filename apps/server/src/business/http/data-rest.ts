import { Hono, type Context, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import type { RequestScope, RequestScopeResolver } from "./request.js";
import { rows, tables } from "../db/schema.js";
import { ServiceError } from "../errors.js";
import * as keys from "../data-api/keys.js";
import * as data from "../data-api/data.js";

/** Both REST and the command transport use exactly the GraphQL capability services. */
export function createDataRestRoutes(acquire: RequestScopeResolver, options: { publicOrigin?: string; clientIp?: (context: Context) => string } = {}) {
  const route = new Hono();
  route.use("*", async (c, next) => {
    const headers = c.req.header("Access-Control-Request-Headers") ?? "";
    if (keys.requestApiKey(c.req.raw) || c.req.method === "OPTIONS" && /authorization|x-tabdo-key/i.test(headers))
      return cors({ origin: "*", credentials: false, allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"], allowHeaders: ["Content-Type", "Authorization", "X-Tabdo-Key"] })(c, next);
    return next();
  });
  route.use("*", (c, next) => keys.requestApiKey(c.req.raw) ? bodyLimit({ maxSize: 128 * 1024 })(c, next) : next());
  type Input = { scope: RequestScope; context: data.SiteContext; c: Context; body: Record<string, unknown> };
  const handle = (write: boolean, fn: (input: Input) => Promise<unknown>, status: 200 | 201 = 200) => async (c: Context, next: Next) => {
    const secret = keys.requestApiKey(c.req.raw); if (!secret) return next();
    let scope: RequestScope | undefined;
    try {
      if (Number(c.req.header("Content-Length")) > 128 * 1024) throw new ServiceError(413, { message: "Request body too large" });
      const raw = ["GET", "DELETE"].includes(c.req.method) ? "" : await c.req.text();
      if (new TextEncoder().encode(raw).byteLength > 128 * 1024) throw new ServiceError(413, { message: "Request body too large" });
      let body: Record<string, unknown> = {};
      try { body = raw ? z.record(z.string(), z.unknown()).parse(JSON.parse(raw)) : {}; }
      catch { throw new ServiceError(400, { message: "Invalid request data" }); }
      scope = await acquire(c.req.raw);
      const principal = await keys.resolveSiteKey(scope.commands.database, secret);
      if (!scope.siteRateLimit) throw new ServiceError(503, { message: "API rate limiting is unavailable" });
      await scope.siteRateLimit({ keyId: principal.id, ip: options.clientIp?.(c) ?? "unknown", kind: write ? "create" : "read" });
      const context = { principal, secret, baseUrl: options.publicOrigin ?? new URL(c.req.url).origin };
      c.header("Cache-Control", "private, no-store");
      return c.json(await fn({ scope, context, c, body }), status);
    } catch (error) {
      if (error instanceof ServiceError) return c.json({ error: error.message }, error.status as 400);
      if (error instanceof z.ZodError) return c.json({ error: "Invalid request data" }, 400);
      return c.json({ error: "Request could not be completed" }, 500);
    } finally { try { await scope?.close(); } catch { /* Committed responses survive cleanup failures. */ } }
  };
  const locate = async ({ scope, context }: Input, rowId: unknown) => {
    const id = z.uuid().parse(rowId);
    const [found] = await scope.commands.database.select({ tableId: rows.tableId }).from(rows).innerJoin(tables, eq(tables.id, rows.tableId))
      .where(and(eq(rows.id, id), eq(tables.organizationId, context.principal.organizationId)));
    if (!found) throw new ServiceError(404, { message: "Record not found" }); return found.tableId;
  };
  route.get("/tables", handle(false, ({ scope, context }) => data.siteTables(scope.commands, context)));
  route.get("/tables/:id", handle(false, ({ scope, context, c }) => data.siteTable(scope.commands, context, c.req.param("id")!)));
  route.get("/tables/:id/rows", handle(false, ({ scope, context, c }) => data.siteRows(scope.commands, context, c.req.param("id")!, {
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined, cursor: c.req.query("cursor"), includeTotal: c.req.query("includeTotal") === "true" || c.req.query("includeTotal") === "1",
  })));
  route.post("/tables/:id/rows/query", handle(false, ({ scope, context, c, body }) => data.siteRows(scope.commands, context, c.req.param("id")!, body)));
  route.post("/tables/:id/rows", handle(true, ({ scope, context, c, body }) => data.siteCreateRow(scope.commands, context, c.req.param("id")!, body.cells), 201));
  route.get("/tables/:id/rows/:rowId", handle(false, ({ scope, context, c }) => data.siteRow(scope.commands, context, c.req.param("id")!, c.req.param("rowId")!)));
  route.patch("/tables/:id/rows/:rowId", handle(true, ({ scope, context, c, body }) => data.siteUpdateRow(scope.commands, context, c.req.param("id")!, c.req.param("rowId")!, body.cells, body.expectedVersion as number | undefined)));
  route.delete("/tables/:id/rows/:rowId", handle(true, ({ scope, context, c }) => data.siteDeleteRow(scope.commands, context, c.req.param("id")!, c.req.param("rowId")!)));
  route.post("/commands", handle(true, async input => {
    const { scope, context, body } = input, command = z.string().parse(body.command), args = z.record(z.string(), z.unknown()).parse(body.input ?? {});
    if (["organizationId", "actorId", "skipAutomation"].some(key => Object.hasOwn(args, key))) throw new ServiceError(400, { message: "Internal execution options cannot be supplied" });
    const deps = scope.commands;
    if (!["listTables", "getTable", "queryRows", "getRow", "addRow", "updateCell", "updateCells", "deleteRow"].includes(command)) throw new ServiceError(403, { message: "API keys only authorize table record CRUD" });
    let result: unknown;
    if (command === "listTables") result = await data.siteTables(deps, context);
    else {
      const tableId = args.tableId === undefined ? await locate(input, args.rowId) : z.uuid().parse(args.tableId);
      switch (command) {
        case "getTable": result = await data.siteTable(deps, context, tableId); break;
        case "queryRows": { const { tableId: _, ...options } = args; result = await data.siteRows(deps, context, tableId, options); break; }
        case "getRow": result = await data.siteRow(deps, context, tableId, z.uuid().parse(args.rowId)); break;
        case "addRow": result = await data.siteCreateRow(deps, context, tableId, args.cells); break;
        case "updateCell": case "updateCells": result = await data.siteUpdateRow(deps, context, tableId, z.uuid().parse(args.rowId), command === "updateCell" ? { [z.uuid().parse(args.columnId)]: args.value } : args.cells, args.expectedVersion as number | undefined); break;
        case "deleteRow": result = await data.siteDeleteRow(deps, context, tableId, z.uuid().parse(args.rowId)); break;
        default: throw new ServiceError(403, { message: "API keys only authorize table record CRUD" });
      }
    }
    return { ok: true, command, result };
  }));
  return route;
}
