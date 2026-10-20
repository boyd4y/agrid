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
const rowInput = object({ body: ref("BodyWrite"), idempotencyKey: { type: "string", minLength: 1, maxLength: 200 }, cells, expectedVersion: { type: "integer", minimum: 1, description: "Optional optimistic concurrency check for updates." } });

/** Full /api paths with server / keep imports relative to the deployment origin. */
export const openApiDocument = {
  openapi: "3.1.0",
  info: { title: "Tabdo Table API", version: "0.1.0", description: "Table metadata and record CRUD using restricted tab_ API keys. Related: POST /api/graphql (GraphQL schema available by authenticated introspection). See /docs. Rows include optional rich text body and owned attachments. Site views use ordinary table Read and Update; only an explicit publication patch changes public content. Calendar APIs are outside this specification." },
  servers: [{ url: "/", description: "Current deployment origin" }],
  security: [{ bearerAuth: [] }, { tabdoKey: [] }],
  externalDocs: { url: "/docs", description: "Tabdo documentation" },
  paths: {
    "/api/tables": { get: operation("listTables", "List authorized tables and columns", { type: "array", items: ref("Table") }) },
    "/api/tables/{id}": { get: operation("getTable", "Get authorized table metadata", ref("Table"), [parameter("id")]) },
    "/api/tables/{id}/rows": {
      get: operation("listRows", "Read a page of rows (Read permission)", ref("RowsPage"), [parameter("id"), { name: "cursor", in: "query", schema: { type: "string" } }, { name: "limit", in: "query", schema: limit }, { name: "includeTotal", in: "query", schema: { type: "boolean", default: false } }]),
      post: operation("createRow", "Create a row (Create permission)", object({ id: { type: "string" }, bodyVersion: { type: "integer", minimum: 1 }, createdAt: { type: "string", format: "date-time" } }, ["id", "createdAt"]), [parameter("id")], object({ cells, body: ref("BodyCreate"), idempotencyKey: { type: "string" } }), 201),
    },
    "/api/tables/{id}/rows/query": { post: operation("queryRows", "Read rows with filters and sorting; reuse options with nextCursor", ref("RowsPage"), [parameter("id")], ref("RowsQuery")) },
    "/api/tables/{id}/rows/{rowId}": {
      get: operation("getRow", "Read a row; returns null when no matching row exists", { anyOf: [ref("Row"), { type: "null" }] }, [parameter("id"), parameter("rowId"), { name: "include", in: "query", schema: { const: "body" } }, { name: "bodyFormat", in: "query", schema: { enum: ["json", "html"] } }]),
      patch: operation("updateRow", "Update cells (Update permission)", object({ id: { type: "string" }, bodyVersion: { type: "integer", minimum: 1 }, updatedAt: { type: "string", format: "date-time" }, version: { type: "integer" } }, ["id", "updatedAt", "version"]), [parameter("id"), parameter("rowId")], rowInput),
      delete: operation("deleteRow", "Delete a row (Delete permission; linked tables may require Update)", object({ id: { type: "string" } }, ["id"]), [parameter("id"), parameter("rowId")]),
    },
    "/api/tables/{id}/rows/{rowId}/attachments": { post: operation("uploadRowAttachment", "Upload an owned body image (Update); no separate body creation", ref("Attachment"), [parameter("id"), parameter("rowId")], object({ target: { const: "body" }, expectedVersion: { type: "integer", minimum: 0 }, name: { type: "string" }, mimeType: { enum: ["image/png", "image/jpeg", "image/webp", "image/gif"] }, base64: { type: "string" }, idempotencyKey: { type: "string" } }, ["expectedVersion", "name", "mimeType", "base64", "idempotencyKey"])) },
    "/api/tables/{id}/rows/{rowId}/attachments/{fileId}": { get: operation("getRowAttachment", "Read an owned private attachment (Read)", ref("Attachment"), [parameter("id"), parameter("rowId"), parameter("fileId")]) },
    "/api/commands": { post: operation("executeTableCommand", "Execute a table record command with the same per-table permissions", object({ ok: { const: true }, command: { type: "string" }, result: {} }, ["ok", "command", "result"]), [], object({ command: { type: "string", enum: ["listTables", "getTable", "queryRows", "getRow", "addRow", "updateCell", "updateCells", "deleteRow", "uploadRowAttachment", "getRowAttachment", "listViews", "getView", "createView", "updateView", "deleteView"] }, input: { type: "object", description: "Command arguments: tableId; rowId for row operations; cells for addRow/updateCells; columnId and value for updateCell; optional expectedVersion for updates. body uses BodyCreate/BodyWrite; includeBody projects Body on getRow. Site views: createView(tableId,type=site,name,config,idempotencyKey); updateView(viewId,expectedVersion,idempotencyKey,name?,config?,publication?:Publication). Config and source saves never publish. queryRows accepts RowsQuery fields. listTables accepts {}. Internal organization/actor/workspace options are forbidden.", additionalProperties: true, example: { tableId: "TABLE_UUID", cells: { COLUMN_UUID: "Hello" } } } }, ["command"])) },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "Restricted tab_ key from Settings → API Key. Send Authorization: Bearer tab_... . API permissions still apply; the public specification grants no access." },
      tabdoKey: { type: "apiKey", in: "header", name: "X-Tabdo-Key", description: "Alternative header for the same tab_ key." },
    },
    schemas: {
      BodyCreate: object({ content: { type: "object", description: "Validated Tiptap doc, at most 64 KiB. Images reference only this row's attachment fileId." } }, ["content"]),
      BodyWrite: object({ content: { type: "object" }, expectedVersion: { type: "integer", minimum: 0, description: "0 for first save. Body writes require idempotencyKey. Mixed cells/body writes are atomic." } }, ["content", "expectedVersion"]),
      Body: object({ content: { type: "object" }, version: { type: "integer", minimum: 0 }, schemaVersion: { const: 1 }, attachments: { type: "array", items: ref("Attachment") }, html: { type: "string" } }, ["content", "version", "schemaVersion", "attachments"]),
      Attachment: object({ fileId: { type: "string", format: "uuid" }, name: { type: "string" }, mimeType: { type: "string" }, size: { type: "integer" }, base64: { type: "string" } }, ["fileId", "name", "mimeType", "size"]),
      View: object({ id: { type: "string" }, tableId: { type: "string" }, type: { const: "site" }, name: { type: "string" }, config: { type: "object", description: "template=blog; mapping of source table fields (title required, slug optional); explicit articles rowId/imageIds/coverFileId selection. Omitted slug uses row ID." }, site: { type: "object", description: "id,version,revisionId,publishedRevisionId,publicUrl,pendingChanges,publishedRows" } }),
      Publication: object({ action: { enum: ["publish", "unpublish", "withdraw"] }, expectedPublishedRevisionId: { type: ["string", "null"] }, rowId: { type: "string", description: "Required for withdraw; retains other published copies." } }, ["action", "expectedPublishedRevisionId"]),
      Error: object({ error: { type: "string" } }, ["error"]),
      Table: object({ id: { type: "string", format: "uuid" }, name: { type: "string" }, description: { type: ["string", "null"] }, columns: { type: "array", items: object({ id: { type: "string" }, name: { type: "string" }, type: { type: "string" }, readable: { type: "boolean" }, writable: { type: "boolean" }, options: { type: "array", items: object({ id: { type: "string" }, label: { type: "string" }, color: { type: "string" } }) } }) } }, ["id", "name", "columns"]),
      Row: object({ id: { type: "string", format: "uuid" }, tableId: { type: "string", format: "uuid" }, version: { type: "integer" }, cells, body: ref("Body"), files: { type: "array", items: object({ id: { type: "string" }, columnId: { type: "string" }, name: { type: "string" }, mimeType: { type: "string" }, size: { type: "integer" }, url: { type: "string", format: "uri" } }) }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } }, ["id", "tableId", "version", "cells", "files", "createdAt", "updatedAt"]),
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
      name: "tabdo", description: "tabdo connection guide for remote MCP with a restricted API key. This JSON is not a Grok registration protocol.",
      kind: "connection_guide",
      mcp_url: `${origin}/mcp`,
      transport: "streamable-http",
      openapi_url: `${origin}/api/openapi.json`,
      auth: { type: "http", scheme: "bearer", header: "Authorization", prefix: "Bearer", key_prefix: "tab_" },
      recommended_scopes: "Grant Read on tables the bot should query; add Create/Update only if the bot must write. Never grant Delete unless required.",
      docs_url: "/docs",
      install: { steps: [
        "Create an API key in Settings → API Key, select tables, and save the secret shown once. Open Settings → Connect agents for client-specific instructions.",
        `Add a custom MCP server named tabdo in Grok Bot with type Remote HTTPS (Streamable HTTP) and server URL ${origin}/mcp.`,
        "Under HTTP headers, set key Authorization and value Bearer <API key>, replacing <API key> with your saved key. Leave OAuth Client ID and Client Secret empty. Never put secrets in chat or URLs.",
        "Add the server, then find tabdo in Connect apps and install it if prompted. Attach it with @ and ask it to list your authorized tables.",
        "If your version only offers OAuth without a secure HTTP headers form, this API key connection is unavailable. Use a client that supports Bearer headers.",
        "The server must be reachable over public HTTPS. For local development, use a public tunnel and keep /mcp at the end of the URL.",
      ] },
    });
  });
  return route;
}
