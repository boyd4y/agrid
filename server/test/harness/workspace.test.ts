import assert from "node:assert/strict";
import { test } from "node:test";
import {
  restoreWorkspace,
  snapshotWorkspace,
} from "../../src/harness/workspace.js";

test("isolated native workspace roundtrips binary files, modes, directories and links", async () => {
  const fs = await restoreWorkspace();
  await fs.mkdir("/workspace/references", { recursive: true });
  await fs.writeFile(
    "/workspace/references/data.bin",
    Buffer.from([0, 1, 127, 255]),
  );
  await fs.chmod("/workspace/references/data.bin", 0o600);
  await fs.symlink("/workspace/references/data.bin", "/workspace/current");
  const restored = await restoreWorkspace(await snapshotWorkspace(fs));
  assert.deepEqual(
    await restored.readFileBuffer("/workspace/current"),
    Buffer.from([0, 1, 127, 255]),
  );
  assert.equal(
    (await restored.stat("/workspace/references/data.bin")).mode & 0o7777,
    0o600,
  );
  assert.equal(
    await restored.readlink("/workspace/current"),
    "/workspace/references/data.bin",
  );
});

test("snapshot rejects traversal, ambiguous duplicate paths and malformed binary data", async () => {
  const entry = {
    path: "/workspace/file",
    type: "file" as const,
    content: "YWJj",
    mode: 0o600,
  };
  for (const path of [
    "/workspace/../file",
    "/workspace/./file",
    "/workspace//file",
    "/workspace/file\0",
    "/",
  ])
    await assert.rejects(restoreWorkspace([{ ...entry, path }]), /路径无效/);
  await assert.rejects(restoreWorkspace([entry, entry]), /路径无效/);
  for (const content of ["!!", "a===", "YR=="])
    await assert.rejects(restoreWorkspace([{ ...entry, content }]), /内容无效/);
  await assert.rejects(
    restoreWorkspace([{ ...entry, content: undefined }]),
    /内容无效/,
  );
});

test("snapshot file count and byte limits are enforced before files are reused", async () => {
  await assert.rejects(
    restoreWorkspace(
      Array.from({ length: 4001 }, (_, i) => ({
        path: `/workspace/f${i}`,
        type: "directory" as const,
        mode: 0o755,
      })),
    ),
  );
  await assert.rejects(
    restoreWorkspace([
      {
        path: "/workspace/large",
        type: "file",
        content: Buffer.alloc(32 * 1024 * 1024 + 1).toString("base64"),
        mode: 0o600,
      },
    ]),
    /32 MB/,
  );
});
