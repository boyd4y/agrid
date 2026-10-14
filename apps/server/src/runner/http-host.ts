import type { ExecutionAdapter, ExecutionHandle } from "@tabdo/core/execution";
import { createExecutionHttpHost, type ExecutionSnapshot } from "@tabdo/core/transport/execution-http-host";
import type { InternalAuthenticationOptions } from "@tabdo/core/internal-auth";
import { z } from "zod";
import { withNodeResources } from "../resources/node.js";
import { requestRunCancellation } from "../harness/runs.js";
import { loadNativeExecution } from "./repository.js";

/** Private service only. Signed bodies locate already-accepted work, never create a principal or Run. */
export function createNativeExecutionHttpHost(options: { executor: ExecutionAdapter; authentication: InternalAuthenticationOptions }) {
  const snapshot = async (id: string, handle?: ExecutionHandle): Promise<ExecutionSnapshot> => {
    const loaded = await loadNativeExecution(id);
    return { resource: handle?.resource ?? { id, provider: "native-runner", reference: id },
      state: loaded.execution.status === "settled" ? "exited" : handle ? "running" : "unknown",
      // This durable receipt certifies the native attempt settled, not the physical OS exit code.
      ...(loaded.execution.status === "settled" ? { exit: { code: null, signal: null } } : {}) };
  };
  const host = createExecutionHttpHost({ authentication: options.authentication, services: {
    async accept(request) {
      z.uuid().parse(request.id);
      const reference = z.object({ executionId: z.uuid() }).strict().parse(request.reference);
      if (reference.executionId !== request.id) throw new Error("Execution reference mismatch");
      const loaded = await loadNativeExecution(request.id);
      let handle = await options.executor.lookup(request.id);
      if (!handle && loaded.execution.status === "accepted") handle = await options.executor.start(request);
      // Replayed signed requests observe the PG receipt; invoking/settled is never launched again.
      return snapshot(request.id, handle);
    },
    async lookup(id) {
      z.uuid().parse(id);
      return snapshot(id, await options.executor.lookup(id));
    },
    async terminate(id) {
      const loaded = await loadNativeExecution(z.uuid().parse(id));
      await requestRunCancellation(loaded.thread.id, loaded.run.id, loaded.actor);
      const handle = await options.executor.lookup(id);
      // Persisted cancellation is sufficient for a live runner on another host to observe it.
      // Unlocatable computing is unknown until its authoritative attempt settles.
      if (handle) await handle.terminate();
      return snapshot(id);
    },
  } });
  return (request: Request) => withNodeResources(() => host(request));
}
