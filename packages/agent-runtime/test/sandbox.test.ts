import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, stat, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { createLocalSandboxAdapter } from "../src/sandbox/local.js";
import { createDiskWorkspace } from "../src/sandbox/workspace.js";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

test("real disk sessions restore through an explicit caller-owned workspace callback", async () => {
  const fs = await createDiskWorkspace();
  const adapter = createLocalSandboxAdapter({ cwd: "/project", env: {}, createFilesystem: async () => fs });
  const first = await adapter.create({ sandboxId: "opaque-environment" });
  try {
    assert.equal(first.session.id, "opaque-environment");
    assert.equal(first.session.defaultWorkingDirectory, join(fs.root, "project"));
    assert.equal(adapter.networkAccessible, true);
    const original = join(first.session.defaultWorkingDirectory, "note.txt");
    await first.session.writeTextFile({ path: original, content: "persisted" });
    assert.equal(await readFile(original, "utf8"), "persisted", "writes reach the real OS filesystem");
    await assert.rejects(adapter.resume({ sandboxId: "opaque-environment" }), /persisted workspace restorer/);
    const nextFs = await createDiskWorkspace();
    await nextFs.writeFile("project/note.txt", await fs.readFileBuffer(original));
    let restored = false;
    const next = await createLocalSandboxAdapter({ cwd: "/project", env: {}, restoreFilesystem: async reference => {
      assert.equal(reference.sandboxId, "opaque-environment"); restored = true; return nextFs;
    } }).resume({ sandboxId: "opaque-environment" });
    try {
      assert(restored);
      assert.notEqual(next.workspace.root, first.workspace.root);
      assert.equal(await next.session.readTextFile({ path: "note.txt" }), "persisted");
    } finally { await next.session.destroy(); }
  } finally { await first.session.destroy(); }
});

test("SDK file streams, binary bytes and inclusive line ranges operate on real files", async () => {
  const opened = await createLocalSandboxAdapter({ cwd: "/workspace", env: {} }).create();
  const session = opened.session;
  try {
    await session.writeTextFile({ path: "lines.txt", content: "one\ntwo\nthree\n" });
    assert.equal(await session.readTextFile({ path: "lines.txt", startLine: 2, endLine: 2 }), "two");
    assert.equal(await session.readTextFile({ path: "lines.txt", startLine: 3, endLine: 20 }), "three\n");
    assert.equal(await session.readTextFile({ path: "lines.txt", startLine: 9 }), "");
    assert.equal(await session.readTextFile({ path: "lines.txt", startLine: 0, endLine: 1 }), "one");
    assert.equal(await session.readTextFile({ path: "lines.txt", startLine: 3, endLine: 1 }), "");
    for (const ending of ["\r\n", "\r", "\n"]) {
      await session.writeTextFile({ path: "newline.txt", content: `one${ending}two${ending}three` });
      assert.equal(await session.readTextFile({ path: "newline.txt", startLine: 1, endLine: 2 }), `one${ending}two`);
    }
    assert.equal(await session.readTextFile({ path: "absent.txt" }), null);
    const data = new Uint8Array([0, 255, 10, 17]);
    await session.writeFile({ path: "nested/bytes.dat", content: new ReadableStream({ start(controller) { controller.enqueue(data);controller.close(); } }) });
    assert.deepEqual(new Uint8Array((await session.readBinaryFile({ path: "nested/bytes.dat" }))!), data);
    assert.deepEqual(new Uint8Array(await new Response(await session.readFile({ path: "nested/bytes.dat" })).arrayBuffer()), data);
    assert.equal((await stat(join(session.defaultWorkingDirectory, "nested/bytes.dat"))).size, data.length);
  } finally { await session.destroy(); }
});

test("native Bash executes pipes, real Node and Python zipfile without inheriting platform credentials", async () => {
  const previous = new Map(["DATABASE_URL", "PI_API_KEY", "OPENROUTER_API_KEY", "NODE_OPTIONS", "BASH_ENV"].map(key => [key, process.env[key]]));
  for (const key of previous.keys()) process.env[key] = "private-fixture-do-not-inherit";
  const opened = await createLocalSandboxAdapter({ cwd: "/project", env: { FIXTURE_VALUE: "explicit" } }).create();
  try {
    const result = await opened.session.run({ command: `${quote(process.execPath)} -e 'console.log(JSON.stringify({ cwd:process.cwd(),home:process.env.HOME,value:process.env.FIXTURE_VALUE,pg:typeof process.env.DATABASE_URL,key:typeof process.env.PI_API_KEY,router:typeof process.env.OPENROUTER_API_KEY,node:typeof process.env.NODE_OPTIONS,bash:typeof process.env.BASH_ENV }))'` });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(result.stdout), { cwd: opened.session.defaultWorkingDirectory, home: opened.workspace.root, value: "explicit", pg: "undefined", key: "undefined", router: "undefined", node: "undefined", bash: "undefined" });
    const python = await opened.session.run({ command: "printf '%s' real-shell | tr a-z A-Z; python3 -c 'import zipfile; z=zipfile.ZipFile(\"actual.zip\",\"w\"); z.writestr(\"entry.txt\",\"real-python\"); z.close()'" });
    assert.equal(python.exitCode, 0, python.stderr);
    assert.equal(python.stdout, "REAL-SHELL");
    assert((await stat(join(opened.session.defaultWorkingDirectory, "actual.zip"))).size > 20);
    assert((await opened.session.readBinaryFile({ path: "actual.zip" }))!.length > 20, "SDK reads the Python-created binary from the same real directory");
    await opened.session.writeTextFile({ path: "sdk-source.txt", content: "SDK wrote this" });
    assert.equal((await opened.session.run({ command: "cat sdk-source.txt" })).stdout, "SDK wrote this");
    const failed = await opened.session.run({ command: "printf output; printf error >&2; exit 7" });
    assert.deepEqual(failed, { exitCode: 7, stdout: "output", stderr: "error" });
  } finally {
    await opened.session.destroy();
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key];else process.env[key] = value; }
  }
});

test("filesystem APIs reject traversal and symlink escapes, while snapshots do not follow links", async () => {
  const opened = await createLocalSandboxAdapter({ cwd: "/workspace", env: {} }).create();
  const outside = await mkdtemp(join(tmpdir(), "tabdo-outside-fixture-"));
  try {
    await writeFile(join(outside, "secret.txt"), "outside");
    await assert.rejects(async () => await opened.session.readTextFile({ path: join(outside, "secret.txt") }), /outside the workspace/);
    await assert.rejects(async () => await opened.session.writeTextFile({ path: "../../escape.txt", content: "escape" }), /outside the workspace/);
    await opened.session.run({ command: `ln -s ${quote(outside)} escape` });
    await assert.rejects(async () => await opened.session.readBinaryFile({ path: "escape/secret.txt" }), /outside the workspace/);
    const paths = opened.workspace.getAllPaths();
    assert(paths.includes(join(opened.session.defaultWorkingDirectory, "escape")));
    assert(!paths.includes(join(opened.session.defaultWorkingDirectory, "escape/secret.txt")));
    await opened.workspace.writeFile("inside.txt", "inside");
    await opened.workspace.symlink("inside.txt", "inside-link");
    assert.equal(await opened.workspace.readFile("inside-link"), "inside");
    assert((await opened.workspace.lstat("inside-link")).isSymbolicLink);
  } finally { await opened.session.destroy();await rm(outside, { recursive: true, force: true }); }
});

test("spawn streams output and abort force-kills a real process that ignores SIGTERM", { timeout: 5000 }, async () => {
  const opened = await createLocalSandboxAdapter({ cwd: "/workspace", env: {} }).create();
  try {
    const controller = new AbortController();
    const child = await opened.session.spawn({ command: "trap '' TERM; sleep 30 & printf '%s' \"$!\"; wait", abortSignal: controller.signal });
    const reader = child.stdout.getReader();
    const descendant = Number(new TextDecoder().decode((await reader.read()).value));
    assert(Number.isSafeInteger(descendant) && descendant > 1);
    const waiting = Promise.resolve(child.wait());
    controller.abort(new DOMException("fixture abort", "AbortError"));
    await assert.rejects(waiting, /fixture abort/);
    await child.kill();
    assert.throws(() => process.kill(child.pid!, 0), { code: "ESRCH" });
    const descendantState = await new Promise<string>((resolve, reject) => execFile("/bin/ps", ["-o", "stat=", "-p", String(descendant)], (error, stdout) => {
      if (error && (error as Error & { code?: string | number }).code !== 1) reject(error); else resolve(stdout.trim());
    }));
    assert(descendantState === "" || descendantState.startsWith("Z"), "owned descendant is gone or reaped, never still running");
    reader.releaseLock();
  } finally { await opened.session.destroy(); }
});

test("stop kills owned processes but preserves checkpoint files; destroy removes disk and restricted view hides lifecycle", async () => {
  const opened = await createLocalSandboxAdapter({ cwd: "/workspace", env: {} }).create();
  const limited = opened.session.restricted();
  assert.equal("stop" in limited, false);
  assert.equal("destroy" in limited, false);
  assert.equal("getPortEndpoint" in limited, false);
  await limited.writeTextFile({ path: "checkpoint.txt", content: "keep after stop" });
  const child = await limited.spawn({ command: "sleep 30" });
  await opened.session.stop();
  await child.wait();
  assert.equal(await readFile(join(opened.session.defaultWorkingDirectory, "checkpoint.txt"), "utf8"), "keep after stop");
  await assert.rejects(async () => await limited.run({ command: "echo stopped" }), /stopped/);
  await opened.session.destroy();
  await opened.session.destroy();
  await assert.rejects(stat(opened.workspace.root), { code: "ENOENT" });
});


test("aborted creation signal does not poison later SDK checkpoint I/O, while explicit operation signals still cancel", { timeout: 5000 }, async () => {
  const creation = new AbortController();
  const opened = await createLocalSandboxAdapter({ cwd: "/workspace", env: {} }).create({ abortSignal: creation.signal });
  try {
    creation.abort(new DOMException("creation finished", "AbortError"));
    await opened.session.writeTextFile({ path: "checkpoint/journal.jsonl", content: "saved after turn cancellation" });
    assert.equal(await opened.session.readTextFile({ path: "checkpoint/journal.jsonl" }), "saved after turn cancellation");
    assert.equal((await opened.session.run({ command: "cat checkpoint/journal.jsonl" })).stdout, "saved after turn cancellation");
    const operation = new AbortController();
    operation.abort(new DOMException("explicit operation aborted", "AbortError"));
    await assert.rejects(async () => await opened.session.writeTextFile({ path: "must-not-write.txt", content: "no", abortSignal: operation.signal }), /explicit operation aborted/);
    await assert.rejects(async () => await opened.session.readBinaryFile({ path: "checkpoint/journal.jsonl", abortSignal: operation.signal }), /explicit operation aborted/);
    assert.equal(await opened.session.readTextFile({ path: "must-not-write.txt" }), null);
    const running = new AbortController();
    const child = await opened.session.spawn({ command: "printf ready; sleep 30", abortSignal: running.signal });
    const reader = child.stdout.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), "ready");
    const wait = Promise.resolve(child.wait());
    running.abort(new DOMException("explicit process aborted", "AbortError"));
    await assert.rejects(wait, /explicit process aborted/);
    await child.kill();
    assert.throws(() => process.kill(child.pid!, 0), { code: "ESRCH" });
    reader.releaseLock();
    await opened.session.writeTextFile({ path: "checkpoint/after-process.jsonl", content: "cleanup remains available" });
    assert.equal(await opened.session.readTextFile({ path: "checkpoint/after-process.jsonl" }), "cleanup remains available");
  } finally { await opened.session.destroy(); }
});

test("local bridge endpoints, template failure cleanup and durable ID lookup use the same owned resource", async () => {
  const storage = await mkdtemp(join(tmpdir(), "tabdo-local-store-"));
  let attemptedRoot = "";
  try {
    const adapter = createLocalSandboxAdapter({ cwd: "/workspace", env: {}, storageDirectory: storage });
    await assert.rejects(adapter.create({ sandboxId: "failed-template", template: { identity: "fail", prepare: async ({ session }) => {
      attemptedRoot = join(storage, "failed-template");
      await session.writeTextFile({ path: "partial.txt", content: "cleanup" });throw new Error("template failed");
    } } }), /template failed/);
    await assert.rejects(stat(attemptedRoot), { code: "ENOENT" });
    const first = await adapter.create({ sandboxId: "same-resource" });
    const port = first.session.ports[0];
    assert(port > 0);
    assert.equal((await first.session.getPortEndpoint({ port, protocol: "ws" })).url, `ws://127.0.0.1:${port}`);
    await assert.rejects(Promise.resolve(first.session.getPortEndpoint({ port: port === 1 ? 2 : 1 })), /not assigned/);
    await first.session.writeBinaryFile({ path: "saved.bin", content: new Uint8Array([0, 255, 1]) });
    await assert.rejects(adapter.create({ sandboxId: "same-resource" }), { code: "EEXIST" });
    await first.session.stop();
    const second = await createLocalSandboxAdapter({ cwd: "/workspace", env: {}, storageDirectory: storage }).resume({ sandboxId: first.session.id });
    assert.equal(second.workspace.root, first.workspace.root, "native dependency and opaque journal paths remain stable");
    assert.deepEqual(new Uint8Array((await second.session.readBinaryFile({ path: "saved.bin" }))!), new Uint8Array([0, 255, 1]));
    await second.session.destroy();
    await assert.rejects(adapter.resume({ sandboxId: "same-resource" }), { code: "ENOENT" });
    await assert.rejects(adapter.resume({ sandboxId: "../escape" }), /Invalid local sandbox ID/);
    const controller = new AbortController();
    await assert.rejects(adapter.create({ sandboxId: "cancel-template", abortSignal: controller.signal, template: { identity: "cancel", prepare: async () => { controller.abort(new Error("cancel creation")); } } }), /cancel creation/);
    await assert.rejects(stat(join(storage, "cancel-template")), { code: "ENOENT" });
  } finally { await rm(storage, { recursive: true, force: true }); }
});
