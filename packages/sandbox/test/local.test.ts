import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryFs } from "just-bash";
import { createLocalSandboxAdapter } from "../src/adapters/local.js";

test("local SDK environment restores through an explicit caller-owned workspace callback", async () => {
  const fs = new InMemoryFs(); await fs.mkdir("/project", { recursive: true });
  const adapter = createLocalSandboxAdapter({ cwd: "/project", env: {}, createFilesystem: async () => fs });
  const first = await adapter.create({ sandboxId: "opaque-environment" });
  try {
    assert.equal(first.session.id, "opaque-environment");
    assert.equal(first.session.defaultWorkingDirectory, "/project");
    assert.equal(adapter.networkAccessible, false);
    await first.session.writeTextFile({ path: "/project/note.txt", content: "persisted" });
    await assert.rejects(adapter.resume({ sandboxId: "opaque-environment" }), /persisted workspace restorer/);
    const nextFs = new InMemoryFs(); await nextFs.mkdir("/project", { recursive: true });
    await nextFs.writeFile("/project/note.txt", await fs.readFileBuffer("/project/note.txt"));
    let restored = false;
    const next = await createLocalSandboxAdapter({ cwd: "/project", env: {}, restoreFilesystem: async (reference) => {
      assert.equal(reference.sandboxId, "opaque-environment"); restored = true; return nextFs;
    } }).resume({ sandboxId: "opaque-environment" });
    try {
      assert(restored);
      assert.notEqual(next.workspace, first.workspace);
      assert.equal(await next.session.readTextFile({ path: "/project/note.txt" }), "persisted");
    } finally { await next.session.destroy(); }
  } finally { await first.session.destroy(); }
});
