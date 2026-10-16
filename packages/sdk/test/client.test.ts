import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createClient, TabdoApiError } from "../src/index.js";
const key = "tab_pub_" + "a".repeat(43);

test("SDK sends variables over cookie-free GraphQL and preserves cursor/filter options", async () => {
  const requests: Record<string, any>[] = [];
  const client = createClient({ url: "https://tabdo.test", key, fetch: async (url, options) => {
    assert.equal(url, "https://tabdo.test/api/graphql"); assert.equal(options?.credentials, "omit"); assert.equal(options?.redirect, "error");
    assert.equal(new Headers(options?.headers).get("Authorization"), `Bearer ${key}`);
    const body = JSON.parse(String(options?.body)); requests.push(body);
    const data = body.query.includes("query Tables") ? { tables: [] } : body.query.includes("query TableColumns") ? { table: { columns: [] } }
      : body.query.includes("query TableRows") ? { table: { rows: { rows: [], nextCursor: "next", hasMore: true, limit: 2, totalMatched: null } } }
      : body.query.includes("query TableRow") ? { table: { row: null } } : { createRow: { id: "created", createdAt: "2026-10-16T00:00:00.000Z" } };
    return Response.json({ data });
  } });
  assert.deepEqual(await client.tables(), []); assert.deepEqual(await client.table("table").columns(), []);
  const options = { limit: 2, cursor: "opaque", filters: [{ columnId: "column", op: "eq" as const, value: 'not executable: " }' }] };
  assert.equal((await client.table("table").list(options)).nextCursor, "next"); assert.deepEqual(requests[2].variables.options, options);
  assert.equal(await client.table("table").get("row"), null);
  assert.equal((await client.table("table").create({ field: "Submitted" })).id, "created");
  assert.equal(requests[4].variables.cells.field, "Submitted"); assert(!requests[4].query.includes("Submitted"));
});

test("SDK exposes structured GraphQL/HTTP failures, accepts unified credentials and preserves cancellation", async () => {
  assert(createClient({ url: "https://tabdo.test", key: "tab_" + "a".repeat(43) }));
  assert.throws(() => createClient({ url: "file:///tmp/data", key }), /HTTP/);
  const client = createClient({ url: "https://tabdo.test", key, fetch: async () => Response.json({ data: null, errors: [{ message: "Denied", extensions: { code: "FORBIDDEN" } }] }) });
  await assert.rejects(client.tables(), (error: unknown) => error instanceof TabdoApiError && error.code === "FORBIDDEN" && error.status === 200);
  const offline = createClient({ url: "https://tabdo.test", key, fetch: async () => { throw new TypeError("connection secret details"); } });
  await assert.rejects(offline.tables(), (error: unknown) => error instanceof TabdoApiError && error.code === "NETWORK_ERROR" && !error.message.includes("secret"));
  const controller = new AbortController(); controller.abort();
  const aborting = createClient({ url: "https://tabdo.test", key, fetch: async (_url, init) => { init?.signal?.throwIfAborted(); throw new Error("unexpected"); } });
  await assert.rejects(aborting.tables({ signal: controller.signal }), { name: "AbortError" });
});

test("distributed JavaScript and declarations have no internal package or Node runtime dependencies", async () => {
  for (const file of ["index.js", "tabdo.js", "index.d.ts"]) {
    const source = await readFile(new URL(`../dist/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\b(?:from|import)\s*[('"].*(?:@tabdo\/|node:)/);
    assert.doesNotMatch(source, /\bfrom\s*["']\.\//, "distribution must be self-contained");
    assert.doesNotMatch(source, /\bprocess\.env\b/);
  }
});
