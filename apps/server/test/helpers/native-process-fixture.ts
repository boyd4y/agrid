import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createServer, type RequestListener } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import type { TestContext } from "node:test";
import { bounded } from "./chat-fixture.js";

type Context = Pick<TestContext, "signal" | "after" | "diagnostic">;
type ProcessResult = { code: number | null; signal: NodeJS.Signals | null };
export type FixtureProcess = { child: ChildProcess; exited: Promise<ProcessResult> };

/** Only owns fixture processes/groups and the local HTTP provider, never app resources. */
export async function withNativeProcessFixture<T>(
  t: Context,
  work: (fixture: {
    phase: (name: string) => void;
    wait: <V>(operation: Promise<V>) => Promise<V>;
    until: (name: string, predicate: () => Promise<boolean>, child: FixtureProcess, ms?: number) => Promise<void>;
    delay: (ms: number) => Promise<void>;
    listen: (handler: RequestListener) => Promise<string>;
    spawn: (name: string, args: string[], options: SpawnOptions, ms?: number) => FixtureProcess;
  }) => Promise<T>,
): Promise<T> {
  const started = performance.now();
  const ended = new AbortController();
  const interrupted = AbortSignal.any([t.signal, ended.signal]);
  const children: { child: ChildProcess; closed: Promise<ProcessResult>; timer: ReturnType<typeof setTimeout>; name: string; tail: () => string }[] = [];
  const handlers = new Set<Promise<unknown>>();
  let provider: ReturnType<typeof createServer> | undefined;
  let closing = false;
  const phase = (name: string) => t.diagnostic(`[native fixture +${Math.round(performance.now() - started)}ms] ${name}`);
  const wait = async <V>(operation: Promise<V>): Promise<V> => {
    // Attach before checking abort so a concurrently rejecting operation stays observed.
    operation.catch(() => {});
    interrupted.throwIfAborted();
    let abort!: () => void;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        abort = () => reject(interrupted.reason);
        interrupted.addEventListener("abort", abort, { once: true });
      })]);
    } finally { interrupted.removeEventListener("abort", abort); }
  };
  let cleanup: Promise<void> | undefined;
  const close = () => cleanup ??= (async () => {
    const failed = interrupted.aborted;
    closing = true;
    phase("cleanup begin");
    ended.abort(new Error("Native fixture closing"));
    const failures: unknown[] = [];
    for (const { timer } of children) clearTimeout(timer);
    if (provider) {
      try {
        await bounded(new Promise<void>((resolve, reject) => {
          provider!.close(error => error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
          provider!.closeAllConnections();
        }), "native HTTP close");
        await bounded(Promise.allSettled([...handlers]), "native HTTP handlers");
        phase("HTTP closed");
      } catch (error) { failures.push(error); }
    }
    await Promise.all(children.map(async ({ child, closed, timer, name, tail }) => {
      clearTimeout(timer);
      if (failed && tail()) phase(`${name} output tail:\n${tail()}`);
      const signal = (value: NodeJS.Signals) => {
        try {
          if (child.pid) {
            if (process.platform === "win32") child.kill(value);
            else process.kill(-child.pid, value);
          }
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      };
      try {
        let closedAlready = false;
        closed.then(() => { closedAlready = true; });
        await Promise.resolve();
        if (!closedAlready) {
          phase(`${name} cleanup SIGTERM`);
          signal("SIGTERM");
          let grace: ReturnType<typeof setTimeout> | undefined;
          try {
            const graceful = await Promise.race([closed.then(() => true), new Promise<false>(resolve => { grace = setTimeout(() => resolve(false), 1_000); })]);
            if (!graceful) { phase(`${name} cleanup SIGKILL`); signal("SIGKILL"); }
          } finally { clearTimeout(grace); }
        }
        await bounded(closed, `${name} close after cancellation`);
      } catch (error) { failures.push(error); }
    }));
    phase("cleanup end");
    if (failures.length) throw new AggregateError(failures, "Native fixture cleanup failed");
  })();
  t.after(close);
  try {
    const result = await work({
      phase, wait,
      delay: ms => delay(ms, undefined, { signal: interrupted }),
      until: async (name, predicate, child, ms = 16_000) => {
        phase(`wait ${name}`);
        const deadline = performance.now() + ms;
        while (!await wait(predicate())) {
          if (performance.now() >= deadline) throw new Error(`native lifecycle timed out waiting for ${name} after ${ms}ms`);
          await wait(Promise.race([delay(50, undefined, { signal: interrupted }), child.exited.then(() => { throw new Error(`Child exited before ${name}`); })]));
        }
        phase(`reached ${name}`);
      },
      listen: async handler => {
        provider = createServer((request, response) => {
          const task = Promise.resolve().then(() => handler(request, response));
          handlers.add(task);
          task.catch(error => { if (!closing) ended.abort(error); }).finally(() => handlers.delete(task));
        });
        provider.on("error", error => { if (!closing) ended.abort(error); });
        provider.on("close", () => { if (!closing) ended.abort(new Error("Native HTTP fixture closed unexpectedly")); });
        await wait(new Promise<void>((resolve, reject) => {
          provider!.once("error", reject);
          provider!.listen(0, "127.0.0.1", () => { provider!.removeListener("error", reject); resolve(); });
        }));
        const address = provider.address();
        if (!address || typeof address === "string") throw new Error("Native fixture has no TCP address");
        phase("HTTP listening");
        return `http://127.0.0.1:${address.port}/v1`;
      },
      spawn: (name, args, options, ms = 30_000) => {
        interrupted.throwIfAborted();
        const child = spawn(process.execPath, args, { ...options, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe", "ipc"] });
        phase(`${name} spawn pid=${child.pid}`);
        let tail = "", spawnError: Error | undefined;
        child.stdout!.on("data", part => { tail = (tail + part).slice(-4_096); });
        child.stderr!.on("data", part => { tail = (tail + part).slice(-4_096); });
        child.on("message", message => {
          if (message && typeof message === "object" && "fixturePhase" in message && typeof message.fixturePhase === "string") phase(`${name} ${message.fixturePhase}`);
        });
        child.once("error", error => { spawnError = error; ended.abort(error); });
        const closed = new Promise<ProcessResult>(resolve => child.once("close", (code, signal) => {
          phase(`${name} exit code=${code} signal=${signal}`);
          resolve({ code, signal });
        }));
        const timer = setTimeout(() => ended.abort(new Error(`${name} child deadline after ${ms}ms\n${tail}`)), ms);
        closed.then(() => clearTimeout(timer));
        const exited = closed.then(result => {
          if (spawnError) throw spawnError;
          if (result.code !== 0) throw new Error(`${name} exited code=${result.code} signal=${result.signal}\n${tail}`);
          return result;
        });
        exited.catch(error => { if (!closing) ended.abort(error); });
        children.push({ child, closed, timer, name, tail: () => tail });
        return { child, exited };
      },
    });
    interrupted.throwIfAborted();
    await close();
    return result;
  } catch (error) {
    ended.abort(error);
    phase(`interrupted: ${error instanceof Error ? error.message : String(error)}`);
    try { await close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Native test and cleanup failed", { cause: error }); }
    throw error;
  }
}
