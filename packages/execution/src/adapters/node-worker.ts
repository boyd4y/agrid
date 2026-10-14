import { parseExecutionRequest, type ExecutionRequest } from "../index.js";

/** One complete trusted control process. Ready acknowledges boot, not application acceptance. */
export function runNodeExecution(work: (request: ExecutionRequest, signal: AbortSignal) => Promise<void>): Promise<void> {
  if (!process.send) throw new Error("Execution worker requires a Node IPC channel");
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const stop = () => controller.abort(new DOMException("Computing resource terminated", "AbortError"));
    let started = false;
    const cleanup = () => { process.off("message", receive);process.off("SIGTERM", stop);process.off("SIGINT", stop); };
    const receive = (value: unknown) => {
      if (started) return;
      const message = value as { type?: unknown; request?: unknown } | null;
      if (message?.type !== "execution-start") return;
      started = true;
      let request: ExecutionRequest;
      try { request = parseExecutionRequest(message.request); }
      catch (error) { cleanup();reject(error);return; }
      process.send!({ type: "execution-ready", id: request.id });
      // A controller disconnect merely removes its subscription; it is not cancellation.
      Promise.resolve().then(() => work(request, controller.signal)).then(() => { cleanup();resolve(); }, error => { cleanup();reject(error); });
    };
    process.on("message", receive);process.on("SIGTERM", stop);process.on("SIGINT", stop);
  });
}
