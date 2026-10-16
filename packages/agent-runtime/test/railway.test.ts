import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { Sandbox, SandboxFileNotFoundError, type ExecOptions, type ExecResult, type ExecHandle } from "railway";
import { createRailwaySandboxAdapter } from "../src/sandbox/railway.js";

function fixture() {
  const data = new Map<string, Uint8Array>();
  const pending = new Map<string, { stdout: (chunk: string) => void; stderr: (chunk: string) => void; finish: (exitCode: number | null) => void; fail: (error: unknown) => void }>();
  let destroyed = 0, killed = 0;
  const exec = (command: string, options?: ExecOptions) => {
    let resolve!: (result: ExecResult) => void, reject!: (error: unknown) => void;
    const promise = new Promise<ExecResult>((accept, fail) => { resolve = accept;reject = fail; });
    const finish = (exitCode: number | null) => resolve({ exitCode, stdout: command === "pwd" ? "/home/railway\n" : "", stderr: "", truncated: false, timedOut: false });
    pending.set(command, { stdout: chunk => options?.onStdout?.(chunk), stderr: chunk => options?.onStderr?.(chunk), finish, fail: reject });
    const abort = () => reject(options?.signal?.reason);
    options?.signal?.addEventListener("abort", abort, { once: true });
    void promise.finally(() => options?.signal?.removeEventListener("abort", abort)).catch(() => {});
    queueMicrotask(() => {
      if (options?.signal?.aborted) { abort();return; }
      if (command === "manual") return;
      if (command !== "pwd") { options?.onStdout?.("out");options?.onStderr?.("err"); }
      if (command !== "long") finish(command === "failure" ? 7 : 0);
    });
    return Object.assign(promise, { kill: async () => { killed++;finish(null); } }) as unknown as ExecHandle;
  };
  const native = { id: "server-assigned-railway-id", status: "RUNNING", domains: [{ port: 4000, domain: "fixture.up.railway.app" }], exec,
    files: {
      stat: async (path: string) => { if (!data.has(path)) throw new SandboxFileNotFoundError({ operation: "stat", path, message: "missing" });return {}; },
      read: async (path: string) => new Blob([new Uint8Array(data.get(path)!)]).stream(),
      write: async (path: string, stream: ReadableStream<Uint8Array>) => { data.set(path, new Uint8Array(await new Response(stream).arrayBuffer())); },
    },
    heartbeat: async () => {}, destroy: async () => { destroyed++; },
  } as unknown as Sandbox;
  return { native, data, pending, destroyed: () => destroyed, killed: () => killed };
}
const settings = { token: "fixture-only", environmentId: "dedicated-fixture" };

test("Railway reader cancellation discards only that output and preserves the running ExecHandle", async () => {
  const f = fixture(), create = mock.method(Sandbox, "create", async () => f.native);
  const { session } = await createRailwaySandboxAdapter(settings).create();
  try {
    for (const cancelled of ["stdout", "stderr", "both"] as const) {
      const child = await session.spawn({ command: "manual" });
      const stdout = child.stdout.getReader(), stderr = child.stderr.getReader();
      if (cancelled !== "stderr") await stdout.cancel();
      if (cancelled !== "stdout") await stderr.cancel();
      const process = f.pending.get("manual")!;
      assert.doesNotThrow(() => { process.stdout("late output");process.stderr("late error"); });
      let completed = false;
      void Promise.resolve(child.wait()).then(() => { completed = true; });
      await Promise.resolve();
      assert.equal(completed, false, "reader cancellation must not settle or kill the process");
      assert.equal(f.killed(), 0);
      process.finish(7);
      assert.deepEqual(await child.wait(), { exitCode: 7 });
      for (const [name, reader] of [["stdout", stdout], ["stderr", stderr]] as const) {
        if (cancelled !== "both" && cancelled !== name) {
          const chunk = await reader.read();
          assert.equal(new TextDecoder().decode(chunk.value), name === "stdout" ? "late output" : "late error");
        }
        assert.equal((await reader.read()).done, true);
      }
      assert.doesNotThrow(() => { process.stdout("after exit");process.stderr("after exit"); });
      stdout.releaseLock();stderr.releaseLock();
    }
  } finally { await session.destroy();create.mock.restore(); }
});

test("Railway keeps transport and abort failures observable after output cancellation", async () => {
  const f = fixture(), create = mock.method(Sandbox, "create", async () => f.native);
  const { session } = await createRailwaySandboxAdapter(settings).create();
  try {
    for (const cancelOutput of [false, true]) {
      const controller = new AbortController();
      const child = await session.spawn({ command: "manual", abortSignal: controller.signal });
      const stdout = child.stdout.getReader(), stderr = child.stderr.getReader();
      if (cancelOutput) await stdout.cancel();
      const error = new Error(cancelOutput ? "fixture abort" : "fixture transport failure");
      const wait = assert.rejects(Promise.resolve(child.wait()), reason => reason === error);
      const reads = [assert.rejects(stderr.read(), reason => reason === error)];
      if (!cancelOutput) reads.push(assert.rejects(stdout.read(), reason => reason === error));
      if (cancelOutput) controller.abort(error);else f.pending.get("manual")!.fail(error);
      await Promise.all([wait, ...reads]);
      assert.equal(f.killed(), 0);
      assert.doesNotThrow(() => { f.pending.get("manual")!.stdout("late");f.pending.get("manual")!.stderr("late"); });
      stdout.releaseLock();stderr.releaseLock();
    }
  } finally { await session.destroy();create.mock.restore(); }
});

test("Railway maps actual IDs, streamed files/processes, endpoints and idempotent lifecycle", async (context) => {
  const f = fixture();
  const create = mock.method(Sandbox, "create", async () => f.native);
  const heartbeat = mock.method(f.native, "heartbeat", async () => {});
  context.mock.timers.enable({ apis: ["setInterval"] });
  try {
    const adapter = createRailwaySandboxAdapter(settings);
    const { session } = await adapter.create({ template: { identity: "recipe", prepare: async ({ session }) => {
      await session.writeTextFile({ path: "setup", content: "prepared" });
    } } });
    assert.equal(session.id, f.native.id);assert.equal(session.defaultWorkingDirectory, "/home/railway");
    const argument = create.mock.calls[0].arguments[0];
    assert.equal(typeof argument, "object");assert.equal((argument as { networkIsolation: string }).networkIsolation, "PRIVATE");
    assert.equal(await session.readTextFile({ path: "setup" }), "prepared");
    assert.equal(await session.readFile({ path: "missing" }), null);
    const bytes = new Uint8Array([0, 128, 255, 10]);
    await session.writeFile({ path: "binary", content: new Blob([bytes]).stream() });
    assert.deepEqual(await session.readBinaryFile({ path: "binary" }), bytes);
    for (const ending of ["\r\n", "\r", "\n"]) {
      await session.writeTextFile({ path: "lines", content: ["one", "two", "three"].join(ending) });
      assert.equal(await session.readTextFile({ path: "lines", startLine: 2, endLine: 2 }), "two");
      assert.equal(await session.readTextFile({ path: "lines", startLine: 4 }), "");
      assert.equal(await session.readTextFile({ path: "lines", startLine: 3, endLine: 1 }), "");
    }
    assert.deepEqual(await session.run({ command: "failure" }), { exitCode: 7, stdout: "out", stderr: "err" });
    const child = await session.spawn({ command: "long" });
    const output = new Response(child.stdout).text(), error = new Response(child.stderr).text();
    await child.kill();await child.kill();assert.equal((await child.wait()).exitCode, 128);
    assert.equal(await output, "out");assert.equal(await error, "err");assert.equal(f.killed(), 1);
    assert.deepEqual(await session.getPortEndpoint({ port: 4000, protocol: "ws" }), { url: "wss://fixture.up.railway.app" });
    await assert.rejects(Promise.resolve(session.getPortEndpoint({ port: 3000 })), /no published domain/);
    assert(!("destroy" in session.restricted()));
    const active = await session.spawn({ command: "long" });
    context.mock.timers.tick(30_000);assert.equal(heartbeat.mock.callCount(), 1);
    await session.stop();await session.stop();await active.wait();assert.equal(f.destroyed(), 0, "Railway stop retains the same live VM");
    context.mock.timers.tick(60_000);assert.equal(heartbeat.mock.callCount(), 1, "no heartbeat extends VM lifetime after release");
    await assert.rejects(Promise.resolve(session.spawn({ command: "long" })), /stopped/);
    await assert.rejects(Promise.resolve(session.readTextFile({ path: "setup" })), /stopped/);
    await session.destroy();await session.destroy();assert.equal(f.destroyed(), 1);
  } finally { create.mock.restore();heartbeat.mock.restore(); }
});

test("Railway cleans newly acquired resources after failed template and late cancellation", async () => {
  const f = fixture();const create = mock.method(Sandbox, "create", async () => f.native);
  try {
    const adapter = createRailwaySandboxAdapter(settings);
    await assert.rejects(adapter.create({ template: { identity: "broken", prepare: async () => { throw new Error("bootstrap failed"); } } }), /bootstrap failed/);
    assert.equal(f.destroyed(), 1);
    const controller = new AbortController();
    create.mock.mockImplementation(async () => { controller.abort(new Error("late create cancellation"));return f.native; });
    await assert.rejects(adapter.create({ abortSignal: controller.signal }), /late create cancellation/);
    assert.equal(f.destroyed(), 2);
    await assert.rejects(adapter.create({ sandboxId: "cannot-assign" }), /assigns sandbox IDs/);
    const cancelled = AbortSignal.abort(new Error("pre-cancelled"));
    await assert.rejects(adapter.create({ abortSignal: cancelled }), /pre-cancelled/);
    assert.equal(create.mock.callCount(), 2);
  } finally { create.mock.restore(); }
});

test("Railway resume looks up the original ID and never creates or destroys missing or borrowed resources", async () => {
  const f = fixture();const create = mock.method(Sandbox, "create", async () => { throw new Error("must not create"); });
  const connect = mock.method(Sandbox, "connect", async () => { throw new Error("resource missing"); });
  try {
    const adapter = createRailwaySandboxAdapter(settings);
    await assert.rejects(adapter.resume({ sandboxId: "old-id" }), /resource missing/);
    assert.equal(connect.mock.calls[0].arguments[0], "old-id");assert.equal(create.mock.callCount(), 0);assert.equal(f.destroyed(), 0);
    for (const status of ["DESTROYED", "DESTROYING", "FAILED", "CREATING"]) {
      const exec = mock.method(f.native, "exec", () => { throw new Error("must reject state before executing"); });
      connect.mock.mockImplementation(async () => Object.assign(Object.create(f.native), { status }));
      await assert.rejects(adapter.resume({ sandboxId: f.native.id }), /resume requires RUNNING/);
      assert.equal(exec.mock.callCount(), 0);exec.mock.restore();
    }
    connect.mock.mockImplementation(async () => f.native);
    const { session } = await adapter.resume({ sandboxId: f.native.id });
    const cancellation = new AbortController();
    const child = await session.spawn({ command: "long", abortSignal: cancellation.signal });
    cancellation.abort(new Error("cancel process"));await assert.rejects(Promise.resolve(child.wait()), /cancel process/);
    await session.stop();await session.destroy();
    const cancelled = AbortSignal.abort(new Error("cancel lookup"));
    await assert.rejects(adapter.resume({ sandboxId: f.native.id, abortSignal: cancelled }), /cancel lookup/);
    assert.equal(create.mock.callCount(), 0);
  } finally { create.mock.restore();connect.mock.restore(); }
});

test("Railway failed acquisition cleanup retains both causes and the resource ID", async () => {
  const f = fixture(), original = new Error("template unavailable"), cleanup = new Error("destroy unavailable");
  const create = mock.method(Sandbox, "create", async () => f.native);
  const destroy = mock.method(f.native, "destroy", async () => { throw cleanup; });
  try {
    await assert.rejects(createRailwaySandboxAdapter(settings).create({ template: { identity: "failed-cleanup", prepare: async () => { throw original; } } }), error => {
      assert(error instanceof AggregateError);
      assert.equal((error as AggregateError & { sandboxId: string }).sandboxId, f.native.id);
      assert.deepEqual(error.errors, [original, cleanup]);return true;
    });
  } finally { create.mock.restore();destroy.mock.restore(); }
});
