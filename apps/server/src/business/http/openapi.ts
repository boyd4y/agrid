import { Hono } from "hono";
import { cors } from "hono/cors";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const json = (schema: unknown) => ({ "application/json": { schema } });
const parameter = (name: string) => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } });
const errors = Object.fromEntries([[400, "Invalid request"], [401, "Missing or invalid API key"], [403, "Insufficient table permission"], [404, "Resource not found"], [409, "Version conflict"], [413, "Request too large"], [429, "Rate limited"], [500, "Internal error"], [503, "Service unavailable"]].map(([code, description]) => [code, { description, content: json(ref("Error")) }]));
function operation(operationId: string, summary: string, schema: unknown, parameters: unknown[] = [], body?: unknown, status = 200) {
  return { operationId, summary, parameters, ...(body ? { requestBody: { required: true, content: json(body) } } : {}), responses: { ...errors, [status]: { description: "Success", content: json(schema) } } };
}
const cells = { type: "object", description: "Map of column UUIDs to cell values. Select values use option IDs. Writable types: text, number, date, checkbox, select, multi_select.", additionalProperties: true };
const limit = { type: "integer", minimum: 1, maximum: 100, default: 50 };
const rowInput = object({ cells, expectedVersion: { type: "integer", minimum: 1, description: "Optional optimistic concurrency check for updates." } }, ["cells"]);

/** Full /api paths with server / keep imports relative to the deployment origin. */
export const openApiDocument = {
  openapi: "3.1.0",
  info: { title: "Tabdo Table API", version: "0.1.0", description: "Table metadata and record CRUD using restricted tab_ API keys. Related: POST /api/graphql (GraphQL schema available by authenticated introspection). See /docs and docs/api/site-api.md plus docs/api/openapi-and-plugins.md. Calendar, document and blog APIs are outside this specification." },
  servers: [{ url: "/", description: "Current deployment origin" }],
  security: [{ bearerAuth: [] }, { tabdoKey: [] }],
  externalDocs: { url: "/docs", description: "Tabdo documentation" },
  paths: {
    "/api/tables": { get: operation("listTables", "List authorized tables and columns", { type: "array", items: ref("Table") }) },
    "/api/tables/{id}": { get: operation("getTable", "Get authorized table metadata", ref("Table"), [parameter("id")]) },
    "/api/tables/{id}/rows": {
      get: operation("listRows", "Read a page of rows (Read permission)", ref("RowsPage"), [parameter("id"), { name: "cursor", in: "query", schema: { type: "string" } }, { name: "limit", in: "query", schema: limit }, { name: "includeTotal", in: "query", schema: { type: "boolean", default: false } }]),
      post: operation("createRow", "Create a row (Create permission)", object({ id: { type: "string" }, createdAt: { type: "string", format: "date-time" } }, ["id", "createdAt"]), [parameter("id")], object({ cells }, ["cells"]), 201),
    },
    "/api/tables/{id}/rows/query": { post: operation("queryRows", "Read rows with filters and sorting; reuse options with nextCursor", ref("RowsPage"), [parameter("id")], ref("RowsQuery")) },
    "/api/tables/{id}/rows/{rowId}": {
      get: operation("getRow", "Read a row; returns null when no matching row exists", { anyOf: [ref("Row"), { type: "null" }] }, [parameter("id"), parameter("rowId")]),
      patch: operation("updateRow", "Update cells (Update permission)", object({ id: { type: "string" }, updatedAt: { type: "string", format: "date-time" }, version: { type: "integer" } }, ["id", "updatedAt", "version"]), [parameter("id"), parameter("rowId")], rowInput),
      delete: operation("deleteRow", "Delete a row (Delete permission; linked tables may require Update)", object({ id: { type: "string" } }, ["id"]), [parameter("id"), parameter("rowId")]),
    },
    "/api/commands": { post: operation("executeTableCommand", "Execute a table record command with the same per-table permissions", object({ ok: { const: true }, command: { type: "string" }, result: {} }, ["ok", "command", "result"]), [], object({ command: { type: "string", enum: ["listTables", "getTable", "queryRows", "getRow", "addRow", "updateCell", "updateCells", "deleteRow"] }, input: { type: "object", description: "Command arguments: tableId; rowId for row operations; cells for addRow/updateCells; columnId and value for updateCell; optional expectedVersion for updates. queryRows accepts RowsQuery fields. listTables accepts {}. Internal organization/actor/workspace options are forbidden.", additionalProperties: true, example: { tableId: "TABLE_UUID", cells: { COLUMN_UUID: "Hello" } } } }, ["command"])) },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "Restricted tab_ key from Settings → API Key. Send Authorization: Bearer tab_... . API permissions still apply; the public specification grants no access." },
      tabdoKey: { type: "apiKey", in: "header", name: "X-Tabdo-Key", description: "Alternative header for the same tab_ key." },
    },
    schemas: {
      Error: object({ error: { type: "string" } }, ["error"]),
      Table: object({ id: { type: "string", format: "uuid" }, name: { type: "string" }, description: { type: ["string", "null"] }, columns: { type: "array", items: object({ id: { type: "string" }, name: { type: "string" }, type: { type: "string" }, readable: { type: "boolean" }, writable: { type: "boolean" }, options: { type: "array", items: object({ id: { type: "string" }, label: { type: "string" }, color: { type: "string" } }) } }) } }, ["id", "name", "columns"]),
      Row: object({ id: { type: "string", format: "uuid" }, tableId: { type: "string", format: "uuid" }, version: { type: "integer" }, cells, files: { type: "array", items: object({ id: { type: "string" }, columnId: { type: "string" }, name: { type: "string" }, mimeType: { type: "string" }, size: { type: "integer" }, url: { type: "string", format: "uri" } }) }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } }, ["id", "tableId", "version", "cells", "files", "createdAt", "updatedAt"]),
      RowsPage: object({ rows: { type: "array", items: ref("Row") }, nextCursor: { type: ["string", "null"] }, hasMore: { type: "boolean" }, totalMatched: { type: ["integer", "null"] }, limit }, ["rows", "nextCursor", "hasMore", "totalMatched", "limit"]),
      RowsQuery: object({ cursor: { type: ["string", "null"] }, limit, includeTotal: { type: "boolean" }, filters: { type: "array", items: object({ columnId: { type: "string", format: "uuid" }, op: { type: "string", enum: ["eq", "neq", "contains", "not_contains", "is_empty", "is_not_empty", "gt", "gte", "lt", "lte"] }, value: {} }, ["columnId", "op"]) }, filterLogic: { type: "string", enum: ["and", "or"] }, sort: object({ columnId: { type: "string", format: "uuid" }, direction: { type: "string", enum: ["asc", "desc"] } }, ["columnId", "direction"]) }),
    },
  },
};

export function getOpenApiDocument() { return openApiDocument; }

export function createOpenApiRoutes(publicOrigin?: string) {
  const route = new Hono();
  for (const path of ["/openapi.json", "/plugins/grok-bot"])
    route.use(path, cors({ origin: "*", credentials: false, allowMethods: ["GET", "OPTIONS"] }));
  route.get("/openapi.json", c => c.json(getOpenApiDocument()));
  route.get("/plugins/grok-bot", c => {
    const origin = new URL(publicOrigin ?? c.req.url).origin;
    return c.json({
      name: "Tabdo", description: "Query Tabdo tables with a restricted API key.",
      openapi_url: `${origin}/api/openapi.json`,
      auth: { type: "http", scheme: "bearer", header: "Authorization", prefix: "Bearer", key_prefix: "tab_" },
      recommended_scopes: "Grant Read on tables the bot should query; add Create/Update only if the bot must write. Never grant Delete unless required.",
      docs_url: "/docs",
      install: { steps: ["Copy the OpenAPI URL into your Grok Bot connector.", "Create an API key in Settings → API Key using Enable Grok Bot; save the secret shown once.", "Paste the key into the Grok Bot connector's Bearer authentication field. Use Authorization: Bearer tab_... when configuring a header manually."] },
    });
  });
  return route;
}
