import { dispatchKeyCommand } from "../data-api/commands.js";
import { readRowBodies } from "../commands/row-body.js";
import { createOpenApiRoutes } from "./openapi.js";
import { siteQueryCalendarView } from "../data-api/calendar-views.js";
import { BlogError } from "../blogs/errors.js";
import { updateScheduledAutomation } from "../calendar/schedules.js";
import { DocumentError } from "../documents/errors.js";
import { CALENDAR_COMMANDS, CALENDAR_READ_COMMANDS, type CalendarCommand } from "@tabdo/shared";
import { executeCalendar } from "../calendar/service.js";
import { calendarTransportInput } from "../calendar/transport.js";
import { CalendarError } from "../calendar/errors.js";
import { createDataRestRoutes } from "./data-rest.js";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { createSchema, createYoga } from "graphql-yoga";
import { GraphQLError, GraphQLScalarType, Kind, parse, valueFromASTUntyped, type ValidationRule, type SelectionSetNode, type FragmentDefinitionNode } from "graphql";
import { ZodError } from "zod";
import type { RequestScope, RequestScopeResolver } from "./request.js";
import { createRequestRoute, requireActorOrg } from "./request.js";
import { ServiceError } from "../errors.js";
import * as keys from "../data-api/keys.js";
import * as data from "../data-api/data.js";
import { downloadFile } from "../services/files.js";

const calendarQueries = CALENDAR_READ_COMMANDS.map(name => `${name}(input: JSON!): JSON!`).join("\n");
const calendarMutations = CALENDAR_COMMANDS.filter(name => !CALENDAR_READ_COMMANDS.includes(name));
export const siteSchemaSDL = /* GraphQL */ `
  scalar JSON
  type SelectOption { id: ID!, label: String!, color: String }
  type Column { id: ID!, name: String!, type: String!, options: [SelectOption!]!, readable: Boolean!, writable: Boolean! }
  type File { id: ID!, columnId: ID!, name: String!, mimeType: String!, size: Int!, url: String! }
  type Row { id: ID!, tableId: ID!, version: Int!, cells: JSON!, body: JSON, files: [File!]!, createdAt: String!, updatedAt: String! }
  type RowsPage { rows: [Row!]!, nextCursor: String, hasMore: Boolean!, totalMatched: Int, limit: Int! }
  enum FilterOperator { eq neq contains not_contains is_empty is_not_empty gt gte lt lte }
  enum FilterLogic { and or }
  enum SortDirection { asc desc }
  input FilterInput { id: String, columnId: ID!, op: FilterOperator!, value: JSON }
  input SortInput { columnId: ID!, direction: SortDirection! }
  input RowsInput { cursor: String, limit: Int = 50, filters: [FilterInput!], filterLogic: FilterLogic, sort: SortInput, includeTotal: Boolean }
  type Table { id: ID!, name: String!, description: String, columns: [Column!]!, rows(options: RowsInput): RowsPage!, row(id: ID!): Row }
  type Query { queryCalendarView(input: JSON!): JSON! getView(input: JSON!): JSON! listViews(input: JSON!): JSON! getRowAttachment(input: JSON!): JSON! ${calendarQueries} tables: [Table!]!, table(id: ID!): Table }
  type CreateRowPayload { id: ID!, createdAt: String!, bodyVersion: Int }
  type UpdateRowPayload { id: ID!, updatedAt: String!, version: Int!, bodyVersion: Int }
  type DeleteRowPayload { id: ID! }
  type Mutation {
    createView(input: JSON!): JSON! updateView(input: JSON!): JSON! deleteView(input: JSON!): JSON! uploadRowAttachment(input: JSON!): JSON!
    updateAutomation(input: JSON!): JSON!
    ${calendarMutations.map(name => `${name}(input: JSON!): JSON!`).join("\n")}
    createRow(tableId: ID!, cells: JSON, body: JSON, idempotencyKey: String): CreateRowPayload!
    updateRow(tableId: ID!, rowId: ID!, cells: JSON, expectedVersion: Int, body: JSON, idempotencyKey: String): UpdateRowPayload!
    deleteRow(tableId: ID!, rowId: ID!): DeleteRowPayload!
  }
`;

/** Expand fragments when charging complexity, so aliases/fragments cannot bypass limits. */
const boundedQuery: ValidationRule = context => ({ Document(node) {
  const fragments = new Map(node.definitions.filter((definition): definition is FragmentDefinitionNode => definition.kind === Kind.FRAGMENT_DEFINITION).map(fragment => [fragment.name.value, fragment]));
  for (const operation of node.definitions) {
    if (operation.kind !== Kind.OPERATION_DEFINITION) continue;
    let fields = 0, roots = 0, creates = 0, exceeded = false;
    const walk = (set: SelectionSetNode, depth: number, path: Set<string>) => {
      if (depth > 16 || fields > 1000 || roots > 20) { exceeded = true; return; }
      for (const selection of set.selections) {
        if (selection.kind === Kind.FIELD) {
          fields++; if (depth === 1) { roots++; if (["createRow", "updateRow", "deleteRow", ...calendarMutations, "createView", "updateView", "deleteView", "uploadRowAttachment", "updateAutomation"].includes(selection.name.value)) creates++; }
          if (fields > 1000 || roots > 20) { exceeded = true; return; }
          if (selection.selectionSet) walk(selection.selectionSet, depth + 1, path);
        } else if (selection.kind === Kind.INLINE_FRAGMENT) walk(selection.selectionSet, depth, path);
        else {
          const name = selection.name.value, fragment = fragments.get(name);
          if (fragment && !path.has(name)) walk(fragment.selectionSet, depth, new Set([...path, name]));
        }
        if (exceeded) return;
      }
    };
    walk(operation.selectionSet, 1, new Set());
    if (exceeded || creates > 1) context.reportError(new GraphQLError("Query exceeds the site API limits", { extensions: { code: "QUERY_TOO_COMPLEX" } }));
  }
} });

type GraphContext = data.SiteContext & { scope: RequestScope; ip: string; idempotencyKey?: string; budget: { rows: number; queries: number }; bodyLoader?: ReturnType<typeof makeBodyLoader> };
function charge(context: GraphContext, rows: number) {
  context.budget.rows -= rows; context.budget.queries--;
  if (context.budget.rows < 0 || context.budget.queries < 0) throw new GraphQLError("Query exceeds the site API limits", { extensions: { code: "QUERY_TOO_COMPLEX" } });
}
function makeBodyLoader(ctx: GraphContext) {
  let count = 0, bytes = 0;
  const pending: { row: { id: string; tableId: string }; resolve: (body: unknown) => void; reject: (error: unknown) => void }[] = [];
  return (row: { id: string; tableId: string }) => new Promise((resolve, reject) => {
    if (++count > 20) { reject(new GraphQLError("At most 20 bodies per query", { extensions: { code: "QUERY_TOO_COMPLEX" } })); return; }
    pending.push({ row, resolve, reject });
    if (pending.length !== 1) return;
    queueMicrotask(async () => {
      const batch = pending.splice(0);
      try {
        const bodies = await readRowBodies(ctx.scope.commands.database, batch.map(({ row }) => ({ tableId: row.tableId, rowId: row.id })));
        for (const item of batch) bytes += new TextEncoder().encode(JSON.stringify(bodies.get(item.row.id))).length;
        if (bytes > 256 * 1024) throw new GraphQLError("Body projection exceeds 256 KiB", { extensions: { code: "QUERY_TOO_COMPLEX" } });
        batch.forEach(item => item.resolve(bodies.get(item.row.id)));
      } catch (error) { batch.forEach(item => item.reject(error)); }
    });
  });
}
function observe(scope: RequestScope | undefined, event: string, error: unknown) {
  try { scope?.logger?.error(event, error instanceof Error ? error.name : "unknown"); } catch { /* Observation cannot alter an accepted response. */ }
}
function publicError(error: unknown, scope?: RequestScope): never {
  if (error instanceof GraphQLError) throw error;
  if (error instanceof ZodError) throw new GraphQLError("Invalid request data", { extensions: { code: "BAD_USER_INPUT" } });
  if (error instanceof ServiceError) {
    const code = error instanceof BlogError || error instanceof CalendarError || error instanceof DocumentError ? error.code : ({ 400: "BAD_USER_INPUT", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 429: "RATE_LIMITED", 503: "SERVICE_UNAVAILABLE" } as Record<number, string>)[error.status] ?? "INTERNAL_SERVER_ERROR";
    throw new GraphQLError(error.message, { extensions: { code, http: { status: error.status } } });
  }
  observe(scope, "site-api.request", error);
  throw new GraphQLError("Request could not be completed", { extensions: { code: "INTERNAL_SERVER_ERROR" } });
}
const safe = <A extends unknown[], R>(fn: (...args: A) => R | Promise<R>) => async (...args: A) => {
  try { return await fn(...args); } catch (error) { return publicError(error, (args[2] as GraphContext)?.scope); }
};

async function closePublicScope(scope: RequestScope | undefined) {
  try { await scope?.close(); }
  catch (error) { observe(scope, "site-api.close", error); }
}

export function createSiteApiRoutes(acquire: RequestScopeResolver, options: { graphiql?: boolean; publicOrigin?: string; clientIp?: (context: Context) => string } = {}) {
  const publicUrl = options.publicOrigin ? new URL(options.publicOrigin) : undefined;
  if (publicUrl && (!["http:", "https:"].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password)) throw new TypeError("Invalid public API origin");
  const route = new Hono();
  route.route("/", createOpenApiRoutes(options.publicOrigin));
  // This public surface never uses cookies and never inherits management CORS.
  for (const path of ["/graphql", "/site-files/*"]) {
    route.use(path, cors({ origin: "*", credentials: false, allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type", "Authorization", "X-Tabdo-Key", "Idempotency-Key"], maxAge: 600 }));
    route.use(path, async (c, next) => { c.header("Cache-Control", "private, no-store"); c.header("Referrer-Policy", "no-referrer"); await next(); });
  }
  route.use("/graphql", bodyLimit({ maxSize: 8 * 1024 * 1024, onError: c => c.json({ errors: [{ message: "Request body too large", extensions: { code: "PAYLOAD_TOO_LARGE" } }] }, 413) }));
  route.use("/graphql", async (c, next) => {
    if (c.req.method === "POST") {
      const text = await c.req.raw.clone().text();
      if (new TextEncoder().encode(text).byteLength > 128 * 1024) {
        let imageOnly = false;
        try {
          const body = JSON.parse(text);
          if (typeof body.query === "string" && body.query.length <= 8192) {
            const definitions = parse(body.query).definitions, operation = definitions[0];
            imageOnly = definitions.length === 1 && operation.kind === Kind.OPERATION_DEFINITION && operation.operation === "mutation" && operation.selectionSet.selections.length === 1 && operation.selectionSet.selections[0].kind === Kind.FIELD && operation.selectionSet.selections[0].name.value === "uploadRowAttachment";
          }
        } catch { /* The normal GraphQL parser reports malformed small requests. */ }
        if (!imageOnly) return c.json({ errors: [{ message: "Request body too large", extensions: { code: "PAYLOAD_TOO_LARGE" } }] }, 413);
      }
    }
    return next();
  });
  const viewResolver = (command: string) => safe(async (_root: unknown, args: { input: Record<string, unknown> }, ctx: GraphContext) => {
    charge(ctx, 0);
    if (!["getView", "listViews", "getRowAttachment"].includes(command)) await ctx.scope.siteRateLimit!({ keyId: ctx.principal.id, ip: ctx.ip, kind: "create" });
    return (await dispatchKeyCommand(ctx.scope.commands, ctx, { command, input: args.input }, ctx.idempotencyKey)).result;
  });
  const calendarResolver = (command: CalendarCommand) => safe(async (_root: unknown, args: { input: unknown }, ctx: GraphContext) => {
    charge(ctx, ["listCalendarSubscriptions", "listCalendarDeliveries", "getCalendarDelivery"].includes(command) ? 100 : command === "queryBookings" ? 500 : command === "queryScheduledOccurrences" ? 1000 : command === "listBookingReminders" ? 500 : 0);
    if (!CALENDAR_READ_COMMANDS.includes(command)) await ctx.scope.siteRateLimit!({ keyId: ctx.principal.id, ip: ctx.ip, kind: "create" });
    return executeCalendar(ctx.scope.commands, { kind: "key", secret: ctx.secret }, command, calendarTransportInput(command, args.input, ctx.idempotencyKey));
  });
  const schema = createSchema<GraphContext>({ typeDefs: siteSchemaSDL, resolvers: {
    JSON: new GraphQLScalarType({ name: "JSON", serialize: value => value, parseValue: value => value, parseLiteral: (node, variables) => valueFromASTUntyped(node, variables) }),
    Query: {
      queryCalendarView: safe((_root: unknown, args: { input: { limit?: number } }, ctx: GraphContext) => { charge(ctx, args.input?.limit ?? 100); return siteQueryCalendarView(ctx.scope.commands, ctx, args.input); }),
      ...Object.fromEntries(["getView", "listViews", "getRowAttachment"].map(name => [name, viewResolver(name)])),
      ...Object.fromEntries(CALENDAR_READ_COMMANDS.map(name => [name, calendarResolver(name)])),
      tables: safe((_root: unknown, _args: unknown, ctx: GraphContext) => data.siteTables(ctx.scope.commands, ctx)),
      table: safe((_root: unknown, args: { id: string }, ctx: GraphContext) => data.siteTable(ctx.scope.commands, ctx, args.id)),
    },
    Row: { body: safe((row: { id: string; tableId: string }, _args: unknown, ctx: GraphContext) => {
      keys.requireSiteTable(ctx.principal, row.tableId, "read");
      ctx.bodyLoader ??= makeBodyLoader(ctx);
      return ctx.bodyLoader(row);
    }) },
    Table: {
      columns: safe((table: { id: string; columns?: unknown[] }, _args: unknown, ctx: GraphContext) => table.columns ?? data.siteTable(ctx.scope.commands, ctx, table.id).then(value => value.columns)),
      rows: safe((table: { id: string }, args: { options?: { limit?: number } }, ctx: GraphContext) => {
        charge(ctx, args.options?.limit ?? 50); return data.siteRows(ctx.scope.commands, ctx, table.id, args.options);
      }),
      row: safe((table: { id: string }, args: { id: string }, ctx: GraphContext) => {
        charge(ctx, 1); return data.siteRow(ctx.scope.commands, ctx, table.id, args.id);
      }),
    },
    Mutation: { ...Object.fromEntries(["createView", "updateView", "deleteView", "uploadRowAttachment"].map(name => [name, viewResolver(name)])),
      updateAutomation: safe(async (_root: unknown, args: { input: unknown }, ctx: GraphContext) => { charge(ctx, 0); await ctx.scope.siteRateLimit!({ keyId: ctx.principal.id, ip: ctx.ip, kind: "create" }); return updateScheduledAutomation(ctx.scope.commands, ctx.secret, args.input); }), ...Object.fromEntries(calendarMutations.map(name => [name, calendarResolver(name)])), createRow: safe(async (_root: unknown, args: { tableId: string; cells: unknown; body?: import("@tabdo/shared").RowBodyCreate; idempotencyKey?: string }, ctx: GraphContext) => {
      keys.requireSiteTable(ctx.principal, args.tableId, "create");
      await ctx.scope.siteRateLimit!({ keyId: ctx.principal.id, ip: ctx.ip, kind: "create" });
      return data.siteCreateRow(ctx.scope.commands, ctx, args.tableId, args.cells, { body: args.body, idempotencyKey: args.idempotencyKey });
    }),
      updateRow: safe(async (_root: unknown, args: { tableId: string; rowId: string; cells: unknown; expectedVersion?: number; body?: import("@tabdo/shared").RowBodyWrite; idempotencyKey?: string }, ctx: GraphContext) => {
        keys.requireSiteTable(ctx.principal, args.tableId, "update");
        await ctx.scope.siteRateLimit!({ keyId: ctx.principal.id, ip: ctx.ip, kind: "create" });
        return data.siteUpdateRow(ctx.scope.commands, ctx, args.tableId, args.rowId, args.cells, args.expectedVersion, { body: args.body, idempotencyKey: args.idempotencyKey });
      }),
      deleteRow: safe(async (_root: unknown, args: { tableId: string; rowId: string }, ctx: GraphContext) => {
        keys.requireSiteTable(ctx.principal, args.tableId, "delete");
        await ctx.scope.siteRateLimit!({ keyId: ctx.principal.id, ip: ctx.ip, kind: "create" });
        return data.siteDeleteRow(ctx.scope.commands, ctx, args.tableId, args.rowId);
      }),
    },
  } });
  const yoga = createYoga<GraphContext>({ schema, graphqlEndpoint: "/api/graphql", graphiql: options.graphiql ?? false,
    cors: false, batching: false, logging: false,
    plugins: [{ onValidate({ addValidationRule }: { addValidationRule(rule: ValidationRule): void }) { addValidationRule(boundedQuery); } }],
  });
  route.on(["GET", "POST"], "/graphql", async c => {
    let scope: RequestScope | undefined;
    try {
      scope = await acquire(c.req.raw);
      const secret = keys.requestApiKey(c.req.raw);
      const principal = await keys.resolveSiteKey(scope.commands.database, secret);
      // The composition supplies a trusted client address; forwarded headers
      // are deliberately not accepted from arbitrary browsers.
      const ip = options.clientIp?.(c) ?? "unknown";
      if (!scope.siteRateLimit) throw new ServiceError(503, { message: "Site API rate limiting is unavailable" });
      await scope.siteRateLimit({ keyId: principal.id, ip, kind: "read" });
      return await yoga.fetch(c.req.raw, { principal, secret, idempotencyKey: c.req.header("Idempotency-Key"), baseUrl: publicUrl?.origin ?? new URL(c.req.url).origin, scope, ip, budget: { rows: 1000, queries: 30 } });
    } catch (error) {
      try { publicError(error, scope); } catch (mapped) {
        const fault = mapped as GraphQLError;
        const status = error instanceof ServiceError ? error.status : error instanceof ZodError ? 400 : 500;
        return Response.json({ errors: [{ message: fault.message, extensions: { code: fault.extensions.code } }] }, { status });
      }
    } finally { await closePublicScope(scope); }
  });
  route.get("/site-files/:tableId/:rowId/:columnId/:fileId", async c => {
    let scope: RequestScope | undefined;
    try {
      scope = await acquire(c.req.raw);
      const secret = keys.requestApiKey(c.req.raw) || c.req.query("key") || "";
      const principal = await keys.resolveSiteKey(scope.commands.database, secret);
      const { tableId, rowId, columnId, fileId } = c.req.param();
      if (!scope.files || !scope.siteRateLimit) throw new ServiceError(503, { message: "File access is unavailable" });
      await scope.siteRateLimit({ keyId: principal.id, ip: options.clientIp?.(c) ?? "unknown", kind: "read" });
      const file = await data.siteFileReference(scope.commands, { principal, secret, baseUrl: c.req.url }, tableId, rowId, columnId, fileId);
      const { record, body } = await downloadFile({ ...scope.commands, workspaceId: file.workspaceId, ...scope.files, logger: scope.logger }, principal.organizationId, fileId);
      const inline = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(record.mimeType);
      const encoded = encodeURIComponent(record.name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      return new Response(body, { headers: { "Content-Type": record.mimeType, "Content-Length": String(record.size),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="download"; filename*=UTF-8''${encoded}`,
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Referrer-Policy": "no-referrer" } });
    } catch (error) {
      if (error instanceof ServiceError) return c.json({ error: error.message }, error.status as 400);
      observe(scope, "site-api.file", error);
      return c.json({ error: "File access failed" }, 500);
    } finally { await closePublicScope(scope); }
  });
  route.route("/", createDataRestRoutes(acquire, options));
  return route;
}

export function createSiteKeysRoute(acquire: RequestScopeResolver) {
  const route = createRequestRoute(acquire);
  route.use("*", async (c, next) => {
    const scope = requireActorOrg(c); if (!scope.ok) return c.json({ error: scope.error }, scope.status);
    c.set("actor", scope.actor); c.header("Cache-Control", "private, no-store"); await next();
  });
  route.get("/", async c => c.json(await keys.listSiteKeys(c.get("resources").commands, c.get("actor"))));
  route.post("/", async c => c.json(await keys.createSiteKey(c.get("resources").commands, c.get("actor"), await c.req.json().catch(() => null)), 201));
  route.patch("/:id", async c => c.json(await keys.updateSiteKey(c.get("resources").commands, c.get("actor"), c.req.param("id"), await c.req.json().catch(() => null))));
  route.delete("/:id", async c => c.json(await keys.deleteSiteKey(c.get("resources").commands, c.get("actor"), c.req.param("id"))));
  return route;
}
