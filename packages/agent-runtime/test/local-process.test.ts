import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import childProcess, { type ChildProcess } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createLocalSandboxAdapter } from "../src/sandbox/local.js";

// Only the lifecycle fault tests fake OS events/signals. sandbox.test.ts keeps
// the real SIGTERM-resistant process and descendant cancellation regression.
async function fixture(t: TestContext) {
  const child = Object.assign(new EventEmitter(), {
    pid: 2_000_000 as number | undefined, stdout: new PassThrough(), stderr: new PassThrough(),
  });
  const spawn = t.mock.method(childProcess, "spawn", () => child as unknown as ChildProcess);
  syncBuiltinESMExports();
  const signals: (string | number | undefined)[] = [];
  const kill = t.mock.method(process, "kill", (pid: number, signal?: string | number) => {
    assert.equal(pid, -child.pid!);
    signals.push(signal);
    return true;
  });
  const opened = await createLocalSandboxAdapter({ cwd: "/workspace", env: {} }).create();
  t.after(async () => {
    spawn.mock.restore();
    syncBuiltinESMExports();
    // Failed cleanup deliberately rejects destroy; no real process was spawned.
    await opened.workspace.dispose();
  });
  const close = () => { child.stdout.end();child.stderr.end();child.emit("close", 0, null); };
  return { ...opened, child, kill, signals, close };
}

const posix = { skip: process.platform === "win32" };

test("successful group force-kill is not repeated on exit and waits for close", posix, async t => {
  const f = await fixture(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const child = await f.session.spawn({ command: "fixture" });
  let finished = false;
  const waiting = Promise.resolve(child.wait()).then(result => { finished = true;return result; });
  const killing = child.kill();
  const again = child.kill();
  assert.deepEqual(f.signals, ["SIGTERM"]);
  t.mock.timers.tick(250);
  assert.deepEqual(f.signals, ["SIGTERM", "SIGKILL"]);
  f.child.emit("exit", null, "SIGKILL");
  await Promise.resolve();
  assert.equal(finished, false, "exit does not mean inherited stdio has closed");
  assert.deepEqual(f.signals, ["SIGTERM", "SIGKILL"], "no second signal to an exited group");
  f.close();
  await Promise.all([waiting, killing, again, f.session.stop()]);
  await child.kill();
  assert.deepEqual(f.signals, ["SIGTERM", "SIGKILL"]);
});

test("natural leader exit still cleans its owned descendants before close", posix, async t => {
  const f = await fixture(t);
  const child = await f.session.spawn({ command: "fixture" });
  f.child.emit("exit", 0, null);
  assert.deepEqual(f.signals, ["SIGKILL"]);
  const killing = child.kill();
  f.close();
  assert.deepEqual(await child.wait(), { exitCode: 0 });
  await killing;
  await f.session.destroy();
  assert.deepEqual(f.signals, ["SIGKILL"]);
});

for (const code of ["EPERM", "EIO"]) for (const phase of ["exit", "kill", "abort", "timer"] as const) {
  test(`${phase} signal ${code} remains the original awaitable cleanup error`, posix, async t => {
    const f = await fixture(t);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const denied = Object.assign(new Error(`${phase} kill ${code}`), { code, syscall: "kill" });
    const abort = new AbortController();
    const child = await f.session.spawn({ command: "fixture", abortSignal: abort.signal });
    const waiting = assert.rejects(async () => await child.wait(), error => error === denied);
    f.kill.mock.mockImplementation((pid, signal) => {
      assert.equal(pid, -f.child.pid!);
      if (phase !== "timer" || signal === "SIGKILL") throw denied;
      return true;
    });
    let killing: Promise<void> | undefined;
    if (phase === "exit") assert.doesNotThrow(() => f.child.emit("exit", 0, null));
    if (phase === "kill") {
      killing = Promise.resolve(child.kill());
      void killing.catch(() => {});
    }
    if (phase === "abort") assert.doesNotThrow(() => abort.abort(new Error("cancel requested")));
    if (phase === "timer") {
      killing = Promise.resolve(child.kill());
      void killing.catch(() => {});
      assert.doesNotThrow(() => t.mock.timers.tick(250));
    }
    await waiting;
    await assert.rejects(async () => await (killing ?? child.kill()), error => error === denied);
    await assert.rejects(async () => await f.session.stop(), error => error === denied);
    f.close();
    await assert.rejects(async () => await f.session.destroy(), error => error === denied);
    await assert.rejects(async () => await child.wait(), error => error === denied);
  });
}

test("abort cleanup failure is handled even when the caller never waits", posix, async t => {
  const f = await fixture(t);
  const denied = Object.assign(new Error("unobserved kill EPERM"), { code: "EPERM" });
  const abort = new AbortController();
  await f.session.spawn({ command: "fixture", abortSignal: abort.signal });
  f.kill.mock.mockImplementation(() => { throw denied; });
  abort.abort();
  await new Promise<void>(resolve => setImmediate(resolve));
  await assert.rejects(async () => await f.session.stop(), error => error === denied);
  f.close();
});

test("spawn error without exit and later error/exit/close ordering preserve the first error", posix, async t => {
  const f = await fixture(t);
  f.child.pid = undefined;
  const child = await f.session.spawn({ command: "fixture" });
  const original = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
  f.child.emit("error", original);
  await assert.rejects(async () => await child.wait(), error => error === original);
  await assert.rejects(async () => await child.kill(), error => error === original);
  f.child.emit("error", new Error("later error"));
  f.child.emit("exit", 1, null);
  f.close();
  await assert.rejects(async () => await child.wait(), error => error === original);
  await assert.rejects(async () => await child.kill(), error => error === original);
  await assert.rejects(async () => await f.session.stop(), error => error === original);
  assert.deepEqual(f.signals, []);
});

test("ESRCH cleanup is idempotent", posix, async t => {
  const f = await fixture(t);
  const child = await f.session.spawn({ command: "fixture" });
  f.kill.mock.mockImplementation(() => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); });
  const killing = child.kill();
  f.child.emit("exit", 0, null);
  f.close();
  await killing;
  await child.kill();
  await f.session.destroy();
  assert.equal(f.kill.mock.callCount(), 1);
});
