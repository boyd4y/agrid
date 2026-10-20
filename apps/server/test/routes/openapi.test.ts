import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { createSiteApiRoutes } from "../../src/business/http/site-api.js";
import { createOpenApiRoutes, getOpenApiDocument } from "../../src/business/http/openapi.js";

test("public OpenAPI includes table REST operations with deployment-relative paths", async () => {
  const app = new Hono().route("/api", createOpenApiRoutes());
  const response = await app.request("/api/openapi.json");
  assert.equal(response.status, 200);
  const document = await response.json();
  assert.equal(document.openapi, "3.1.0");
  assert.deepEqual(document.servers, getOpenApiDocument().servers);
  for (const [path, methods] of Object.entries({
    "/api/tables": ["get"], "/api/tables/{id}": ["get"],
    "/api/tables/{id}/rows": ["get", "post"], "/api/tables/{id}/rows/query": ["post"],
    "/api/tables/{id}/rows/{rowId}": ["get", "patch", "delete"], "/api/commands": ["post"],
  })) for (const method of methods) assert(document.paths[path][method].responses);
  assert.equal(document.components.securitySchemes.bearerAuth.scheme, "bearer");
  assert.deepEqual(document.security, [{ bearerAuth: [] }, { tabdoKey: [] }]);
});

for (const publicOrigin of [undefined, "https://api.example.test/base"]) {
  test(`public Grok manifest uses ${publicOrigin ? "configured" : "request"} origin`, async () => {
    const app = new Hono().route("/api", createOpenApiRoutes(publicOrigin));
    const response = await app.request("https://local.example.test/api/plugins/grok-bot", { headers: { origin: "https://connector.example.test", Authorization: "Bearer tab_private_fixture" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    const manifest = await response.json();
    assert.equal(manifest.openapi_url, `${publicOrigin ? "https://api.example.test" : "https://local.example.test"}/api/openapi.json`);
    assert.deepEqual(manifest.auth, { type: "http", scheme: "bearer", header: "Authorization", prefix: "Bearer", key_prefix: "tab_" });
    assert.equal(manifest.kind, "connection_guide");
    assert.equal(manifest.mcp_url, `${publicOrigin ? "https://api.example.test" : "https://local.example.test"}/mcp`);
    assert.equal(manifest.transport, "streamable-http");
    const instructions = manifest.install.steps.join(" ");
    assert(instructions.includes(manifest.mcp_url));
    assert.match(instructions, /HTTP headers.*Authorization.*Bearer <API key>/);
    assert.match(instructions, /OAuth Client ID and Client Secret empty/);
    assert.match(instructions, /only offers OAuth without a secure HTTP headers form/);
    assert(!instructions.includes("OpenAPI"));
    assert(!JSON.stringify(manifest).includes("tab_private_fixture"), "public guide must never expose a request credential");
    assert.equal(manifest.docs_url, "/docs");
  });
}

test("site API mounts public discovery without acquiring authenticated resources", async () => {
  const app = new Hono().route("/api", createSiteApiRoutes(async () => {
    assert.fail("public discovery must not acquire a session, database, or key");
  }));
  for (const path of ["/api/openapi.json", "/api/plugins/grok-bot"]) {
    assert.equal((await app.request(path)).status, 200);
  }
});

test("discovery CORS does not intercept table mutation preflights", async () => {
  const app = new Hono().route("/api", createSiteApiRoutes(async () => {
    assert.fail("preflight must not acquire resources");
  }));
  const response = await app.request("/api/tables/table/rows/row", { method: "OPTIONS", headers: {
    origin: "https://connector.example.test", "access-control-request-method": "PATCH",
    "access-control-request-headers": "Authorization, Content-Type",
  } });
  assert.equal(response.status, 204);
  assert(response.headers.get("access-control-allow-methods")?.includes("PATCH"));
});
