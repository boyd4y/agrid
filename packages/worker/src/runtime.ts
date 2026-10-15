export type Closeable = { close(): Promise<void> };
export async function closeResources(resources: readonly (Closeable | undefined)[]) {
  const results = await Promise.allSettled(resources.map((resource) => Promise.resolve().then(() => resource?.close())));
  const errors = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason);
  if (errors.length) throw new AggregateError(errors, "Worker resources failed to close");
}
export type WorkerService = Closeable & { ready: Promise<void> };
export type PollingTask = Readonly<{ name: string; run(): Promise<unknown> }>;

/** One non-overlapping scan loop, independent task failures, interruptible idle and ordered cleanup. */
export function startWorkerService(options: {
  worker: WorkerService; tasks: readonly PollingTask[]; intervalMs: number;
  resources?: readonly Closeable[];
  onError?(task: string, error: unknown): void;
}): WorkerService {
  if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs < 1) throw new TypeError("Invalid worker polling interval");
  const stop = new AbortController();
  const loop = options.worker.ready.then(async () => {
    while (!stop.signal.aborted) {
      for (const task of options.tasks) {
        if (stop.signal.aborted) break;
        try { await task.run(); }
        catch (error) { try { options.onError?.(task.name, error); } catch { /* Keep other tasks alive. */ } }
      }
      if (!stop.signal.aborted) await new Promise<void>((resolve) => {
        const finish = () => { clearTimeout(timer); stop.signal.removeEventListener("abort", finish); resolve(); };
        const timer = setTimeout(finish, options.intervalMs);
        stop.signal.addEventListener("abort", finish, { once: true });
      });
    }
  }, () => {});
  let closed: Promise<void> | undefined;
  return {
    ready: options.worker.ready,
    close() {
      stop.abort();
      return closed ??= (async () => {
        try { await closeResources([{ close: () => loop }, options.worker]); }
        finally { await closeResources(options.resources ?? []); }
      })();
    },
  };
}
