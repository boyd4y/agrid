import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestHarness } from "wrangler";

test("R2 accepts ordinary object keys and streams binary bytes in workerd", { timeout: 45000 }, async () => {
  const server = createTestHarness({ workers: [{ configPath: new URL("./fixture/wrangler.jsonc", import.meta.url) }] });
  try {
    await server.listen();
    const key = "reports/weekly.txt", path = `/${encodeURIComponent(key)}`, bytes = new Uint8Array([0, 255, 3, 128, 10]);
    assert.equal((await server.fetch(path, { method: "PUT", body: bytes, headers: { "content-type": "application/octet-stream" } })).status, 201);
    assert.deepEqual(new Uint8Array(await (await server.fetch(path)).arrayBuffer()), bytes);
    const env = await server.getWorker<StorageTestEnv>().getEnv();
    assert.equal((await env.OBJECTS.head(key))?.httpMetadata?.contentType, "application/octet-stream");
    assert.equal((await server.fetch(`/${encodeURIComponent("../secret")}`)).status, 400);
    assert.equal((await server.fetch(path, { method: "DELETE" })).status, 204);
    assert.equal((await server.fetch(path)).status, 404);
  } finally { await server.close(); }
});
