import { parseExecutionRequest, type ExecutionAdapter, type ExecutionExit, type ExecutionHandle } from "@tabdo/core/execution";
import { parseExecutionSnapshot, type ExecutionSnapshot } from "@tabdo/core/transport/execution-http-host";
import type { ContainerExecutionRpc } from "./container-object.js";

export type CloudflareContainerExecutionOptions = Readonly<{
  resolve(id: string): ContainerExecutionRpc;
  pollIntervalMs?: number;
}>;

/** Worker-side control adapter. Owning durable work and resource cancellation remains application policy. */
export function createCloudflareContainerExecution(options: CloudflareContainerExecutionOptions): ExecutionAdapter {
  const pollMs = options.pollIntervalMs ?? 1000;
  if (!Number.isSafeInteger(pollMs) || pollMs < 10 || pollMs > 30000) throw new TypeError("Invalid resource observation interval");
  let closed = false;
  const observation = new AbortController();
  function open() { if (closed) throw new Error("Container execution observer is closed"); }
  const sleep = () => new Promise<void>((resolve, reject) => {
    const canceled = () => { clearTimeout(timer);reject(new Error("Container execution observation closed")); };
    const timer = setTimeout(() => { observation.signal.removeEventListener("abort", canceled);resolve(); }, pollMs);
    observation.signal.addEventListener("abort", canceled, { once: true });
  });
  function handle(initial: ExecutionSnapshot): ExecutionHandle {
    let completion: Promise<ExecutionExit> | undefined;
    function sameResource(snapshot: ExecutionSnapshot): ExecutionSnapshot {
      if (snapshot.resource.provider !== initial.resource.provider || snapshot.resource.reference !== initial.resource.reference) throw new Error("Container execution resource identity changed");
      return snapshot;
    }
    const observe = async () => {
      let snapshot = initial;
      for (;;) {
        if (snapshot.state === "exited") return snapshot.exit!;
        if (snapshot.state === "unknown") throw new Error("Execution is unknown; do not replay the accepted work");
        open();await sleep();open();
        const next = await options.resolve(initial.resource.id).lookupExecution(initial.resource.id);
        if (!next) throw new Error("Execution ownership is unknown; do not replay the accepted work");
        snapshot = sameResource(parseExecutionSnapshot(next, initial.resource.id));
      }
    };
    return {
      resource: initial.resource,
      // Queue dispatch can await start() without opening a long-lived completion observation.
      get completion() { return completion ??= observe(); },
      async terminate() {
        open();
        const snapshot = await options.resolve(initial.resource.id).terminateExecution(initial.resource.id);
        if (!snapshot) throw new Error("Container execution ownership is unknown");
        const parsed = sameResource(parseExecutionSnapshot(snapshot, initial.resource.id));
        if (parsed.state !== "exited") throw new Error("Container termination is unconfirmed");
        return parsed.exit!;
      },
    };
  }
  return {
    async start(input) {
      open();
      const request = parseExecutionRequest(input);
      const snapshot = parseExecutionSnapshot(await options.resolve(request.id).startExecution(request), request.id);
      if (snapshot.state === "unknown") throw new Error("Execution start is unknown; reconcile without replay");
      return handle(snapshot);
    },
    async lookup(id) {
      open();
      const snapshot = await options.resolve(id).lookupExecution(id);
      return snapshot ? handle(parseExecutionSnapshot(snapshot,id)) : undefined;
    },
    async close() {
      // Closing a Worker observer never terminates the shared container or cancels accepted business work.
      closed = true;observation.abort();
    },
  };
}
