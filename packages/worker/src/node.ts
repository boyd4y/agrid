import type { WorkerService } from "./runtime.js";

/** Node process host only; all configuration is supplied explicitly. */
export async function runWorkerProcess(options: {
  start(): WorkerService; shutdownTimeoutMs: number;
  onReady?(): void; onError?(error: unknown): void;
}): Promise<never> {
  if (!Number.isSafeInteger(options.shutdownTimeoutMs) || options.shutdownTimeoutMs < 1) throw new TypeError("Invalid shutdown timeout");
  const report = (error: unknown) => {
    try { (options.onError ?? console.error)(error); } catch { /* Logging must not prevent shutdown. */ }
  };
  let requestStop!: () => void;
  const stopped = new Promise<void>((resolve) => { requestStop = resolve; });
  process.once("SIGTERM", requestStop); process.once("SIGINT", requestStop);
  let service: WorkerService | undefined, code = 0;
  try {
    service = options.start();
    // Stop requests also work during a slow or failed startup.
    const result = await Promise.race([service.ready.then(() => "ready" as const), stopped.then(() => "stopped" as const)]);
    if (result === "ready") { options.onReady?.(); await stopped; }
  } catch (error) { report(error); code = 1; }
  const deadline = setTimeout(() => { report(new Error("Worker shutdown deadline exceeded")); process.exit(1); }, options.shutdownTimeoutMs);
  try { await service?.close(); }
  catch (error) { report(error); code = 1; }
  clearTimeout(deadline);
  process.removeListener("SIGTERM", requestStop); process.removeListener("SIGINT", requestStop);
  process.exit(code);
}
