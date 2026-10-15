import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  restoreWorkspace,
  snapshotWorkspace,
} from "../../src/harness/workspace.js";

test("isolated native workspace roundtrips binary files, modes, directories and links", async () => {
  const fs = await restoreWorkspace();
  let restored: Awaited<ReturnType<typeof restoreWorkspace>> | undefined;
  try {
    const file = `${fs.root}/workspace/references/data.bin`;
    await fs.mkdir(`${fs.root}/workspace/references`, { recursive: true });
    await fs.writeFile(file, Buffer.from([0, 1, 127, 255]));
    await fs.chmod(file, 0o600);
    await fs.symlink(file, `${fs.root}/workspace/current`);
    const snapshot = await snapshotWorkspace(fs);
    assert(snapshot.every(entry => !entry.path.includes(fs.root)), "snapshot paths remain portable rather than referring to a host temp directory");
    assert.equal(snapshot.find(entry => entry.path === "/workspace/current")?.target, "/workspace/references/data.bin");
    await fs.dispose();
    restored = await restoreWorkspace(snapshot);
    assert.notEqual(restored.root, fs.root, "cold restore allocates another owned directory");
    assert.deepEqual(await restored.readFileBuffer(`${restored.root}/workspace/current`), Buffer.from([0, 1, 127, 255]));
    assert.equal((await restored.stat(`${restored.root}/workspace/references/data.bin`)).mode & 0o7777, 0o600);
    assert.equal(await restored.readlink(`${restored.root}/workspace/current`), `${restored.root}/workspace/references/data.bin`);
  } finally { await fs.dispose();await restored?.dispose(); }

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


test("snapshot restore rejects escaping links and writes beneath links before touching disk", async () => {
  const link = { path: "/workspace/link", type: "symlink" as const, target: "../../outside", mode: 0o777 };
  await assert.rejects(restoreWorkspace([link]), /链接无效/);
  await assert.rejects(restoreWorkspace([{ ...link, target: "/workspace/target" }, { path: "/workspace/link/file", type: "file", mode: 0o600, content: "eA==" }]), /路径无效/);
  const outside = await mkdtemp(join(tmpdir(), "tabdo-snapshot-external-"));
  const fs = await restoreWorkspace();
  try {
    const target = join(outside, "external.txt");await writeFile(target, "owned external fixture");
    await symlink(target, `${fs.root}/workspace/external`);
    await assert.rejects(snapshotWorkspace(fs), /路径无效|outside/);
  } finally { await fs.dispose();await rm(outside, { recursive: true, force: true }); }
});

test("a legacy public virtual root restores into a private real directory", async () => {
  const fs = await restoreWorkspace([{ path: "/", type: "directory", mode: 0o755 },
    { path: "/workspace/legacy.txt", type: "file", mode: 0o600, content: "bGVnYWN5" }]);
  try {
    assert.equal((await fs.stat(fs.root)).mode & 0o777, 0o700);
    assert.equal(await fs.readFile(`${fs.root}/workspace/legacy.txt`), "legacy");
  } finally { await fs.dispose(); }
});
