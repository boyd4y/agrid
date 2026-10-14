import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { mountClientAssets } from "../../src/client-assets.js";

test("Node serves built client routes while preserving API, asset errors and methods", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tabdo-client-assets-"));
  try {
    await mkdir(join(directory, "assets"));
    await writeFile(join(directory, "index.html"), "<!doctype html><title>Tabdo local</title>");
    await writeFile(join(directory, "assets", "app.js"), "console.log('tabdo');");
    const app = new Hono();
    app.get("/api/health", c => c.json({ ok: true }));
    app.post("/api/commands", c => c.json({ accepted: true }));
    mountClientAssets(app, directory);
    for (const route of ["/", "/login", "/app/tables/example"]) {
      const response = await app.request(route);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /text\/html/);
      assert.equal(response.headers.get("cache-control"), "no-cache");
      assert.match(await response.text(), /Tabdo local/);
    }
    assert.deepEqual(await (await app.request("/api/health")).json(), { ok: true });
    assert.deepEqual(await (await app.request("/api/commands", { method: "POST" })).json(), { accepted: true });
    for (const route of ["/api", "/api/not-found", "/assets/not-found.js", "/not-found.png", "/assets/missing"]) {
      assert.equal((await app.request(route)).status, 404, route);
    }
    assert.equal((await app.request("/app", { method: "POST" })).status, 404);
    const script = await app.request("/assets/app.js");
    assert.match(script.headers.get("content-type") ?? "", /javascript/);
    assert.match(await script.text(), /console.log/);
    const head = await app.request("/app/tables/example", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Node rejects an unbuilt client instead of starting an unusable SPA", () => {
  assert.throws(() => mountClientAssets(new Hono(), join(tmpdir(), "tabdo-missing-build", "dist")), /built client index.html/);
});
