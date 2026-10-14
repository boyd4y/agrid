import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageAdapter } from "../src/storage.js";

test("independent Node extension preserves binary streams, exclusive local writes and cleanup", async () => {
  const localDir = await mkdtemp(join(tmpdir(), "tabdo-node-store-"));
  try {
    const store = createStorageAdapter({ driver: "local", localDir });
    const key = "e3/e39e1b5e-ae42-4c50-9179-3597fe83fef1", bytes = new Uint8Array([0, 255, 128]);
    await store.put(key, bytes, "application/octet-stream");
    assert.deepEqual(new Uint8Array(await new Response(await store.open(key)).arrayBuffer()), bytes);
    await assert.rejects(store.put(key, bytes, "application/octet-stream"), /EEXIST/);
    await assert.rejects(store.remove("../secret"), /Invalid object storage key/);
    await store.remove(key);
    await store.remove(key);
    await assert.rejects(store.open(key), /ENOENT/);
  } finally { await rm(localDir, { recursive: true, force: true }); }
});
