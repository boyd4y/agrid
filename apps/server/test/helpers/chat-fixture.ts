import { createServer, type RequestListener } from "node:http";
import type { TestContext } from "node:test";

export type ChatTestFixture = {
  provider: ReturnType<typeof createServer>;
  wait: <V>(operation: Promise<V>) => Promise<V>;
  handshake: (ready: Promise<void>, completion: Promise<string>, stage: () => string) => Promise<void>;
};

export async function bounded<T>(work: Promise<T>, label: string, ms = 2_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} did not finish within ${ms}ms`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

/** Own the HTTP fixture and its environment until accepted chat work has drained. */
export async function withChatFixture<T>(
  t: Pick<TestContext, "signal" | "after" | "diagnostic">,
  options: {
    env: Record<string, string | undefined>;
    handler: RequestListener;
    stop?: () => Promise<void>;
    drained?: () => Promise<void>;
  },
  work: (fixture: ChatTestFixture) => Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries([...Object.keys(options.env), "PI_BASE_URL"].map(key => [key, process.env[key]]));
  const pending = new Set<Promise<unknown>>();
  const ended = new AbortController();
  let closing = false;
  const provider = createServer((request, response) => {
    // RequestListener also permits async fixtures; route their rejection into the waiter.
    Promise.resolve().then(() => options.handler(request, response)).catch(error => ended.abort(error));
  });
  const onClose = () => { if (!closing) ended.abort(new Error("Model HTTP fixture closed before test completion")); };
  provider.on("close", onClose);
  provider.on("error", error => ended.abort(error));
  const interrupted = AbortSignal.any([t.signal, ended.signal]);
  const track = <V>(operation: Promise<V>) => {
    pending.add(operation);
    operation.then(() => pending.delete(operation), () => pending.delete(operation));
    return operation;
  };
  const wait = async <V>(operation: Promise<V>): Promise<V> => {
    track(operation);
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
    closing = true;
    const failures: unknown[] = [];
    try { await bounded(Promise.resolve().then(() => options.stop?.()), "chat cancellation"); }
    catch (error) { failures.push(error); }
    try {
      await bounded(new Promise<void>((resolve, reject) => {
        provider.close(error => error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
        provider.closeAllConnections();
      }), "model HTTP fixture close");
    } catch (error) { failures.push(error); }
    try { await bounded(Promise.allSettled([...pending]), "chat requests/streams drain"); }
    catch (error) { failures.push(error); }
    try { await bounded(Promise.resolve().then(() => options.drained?.()), "native run drain"); }
    catch (error) { failures.push(error); }
    finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      provider.removeListener("close", onClose);
    }
    if (failures.length) throw new AggregateError(failures, "Chat fixture cleanup failed");
  })();
  // Registered before listening or mutating env, and shared with the body's finally path.
  t.after(close);
  let result: T;
  try {
    await wait(new Promise<void>((resolve, reject) => {
      provider.once("error", reject);
      provider.listen(0, "127.0.0.1", () => { provider.removeListener("error", reject); resolve(); });
    }));
    const address = provider.address();
    if (!address || typeof address === "string") throw new Error("Model fixture has no TCP address");
    for (const [key, value] of Object.entries(options.env)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    process.env.PI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
    result = await work({ provider, wait, handshake: async (ready, completion, stage) => {
      track(completion);
      try {
        await wait(Promise.race([ready, completion.then(stream => {
          throw new Error(`Chat completed before model handshake (${stage()})\n${stream}`);
        })]));
      } catch (error) {
        t.diagnostic(`Model handshake interrupted: ${stage()}`);
        throw error;
      }
    } });
    interrupted.throwIfAborted();
  } catch (error) {
    try { await close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Chat test and cleanup failed", { cause: error }); }
    throw error;
  }
  await close();
  return result;
}
