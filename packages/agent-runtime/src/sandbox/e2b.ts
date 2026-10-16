import { createE2BSandbox } from "@e2b/ai-sdk-sandbox";
import { Sandbox, type SandboxOpts } from "e2b";
import type { HarnessV1NetworkSandboxSession } from "@ai-sdk/harness";
import { SandboxConfigurationError, type SandboxAdapter } from "./types.js";

/** File, process and network operations remain owned by E2B's official adapter. */
export function createE2BSandboxAdapter(options: {
  apiKey: string;
  template?: string;
  timeoutMs?: number;
  ports?: number[];
  metadata?: Record<string, string>;
}): SandboxAdapter {
  if (!options.apiKey.trim()) throw new SandboxConfigurationError("E2B requires an explicit API key");
  const ports = [...(options.ports ?? [4000])];
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new SandboxConfigurationError("E2B timeoutMs must be a positive integer");
  if (ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535))
    throw new SandboxConfigurationError("Invalid E2B port");

  const wrap = async (native: Sandbox, abortSignal?: AbortSignal) => {
    abortSignal?.throwIfAborted();
    const session = await createE2BSandbox({ sandbox: native, bridgePorts: ports }).createSession({ abortSignal });
    let stopped = false, destroyed = false;
    const getPortEndpoint: HarnessV1NetworkSandboxSession["getPortEndpoint"] = async ({ port, protocol }) => {
      if (!session.ports.includes(port)) throw new SandboxConfigurationError(`E2B port ${port} is not exposed`);
      return {
        url: `${protocol === "ws" ? "wss" : "https"}://${native.getHost(port)}`,
        ...(native.trafficAccessToken ? { headers: { "e2b-traffic-access-token": native.trafficAccessToken } } : {}),
      };
    };
    // The official wrap-existing API leaves lifecycle ownership to its caller.
    // Private ingress also requires a token header omitted by provider 0.3.0.
    return Object.assign(session, {
      stop: async () => { if (!stopped && !destroyed) { await native.pause(); stopped = true; } },
      destroy: async () => { if (!destroyed) { await native.kill(); destroyed = true; } },
      getPortEndpoint,
      getPortUrl: async (settings: Parameters<typeof getPortEndpoint>[0]) => (await getPortEndpoint(settings)).url,
    });
  };

  return {
    networkAccessible: true,
    async create(request = {}) {
      request.abortSignal?.throwIfAborted();
      if (request.sandboxId !== undefined)
        throw new SandboxConfigurationError("E2B assigns sandbox IDs; create cannot accept a sandboxId");
      const settings: SandboxOpts = {
        apiKey: options.apiKey, timeoutMs,
        metadata: { owner: "tabdo", ...options.metadata },
        network: { allowPublicTraffic: false },
      };
      // Acquire an ID before observing cancellation so teardown can address the
      // resource. Aborting the create HTTP response can lose a billable ID.
      const native = options.template ? await Sandbox.create(options.template, settings) : await Sandbox.create(settings);
      try {
        const session = await wrap(native, request.abortSignal);
        await request.template?.prepare({ session: session.restricted(), abortSignal: request.abortSignal });
        request.abortSignal?.throwIfAborted();
        return { session };
      } catch (error) {
        try { await native.kill(); } catch (cleanup) { throw new AggregateError([error, cleanup], `E2B create cleanup failed for ${native.sandboxId}`); }
        throw error;
      }
    },
    async resume(request) {
      request.abortSignal?.throwIfAborted();
      const native = await Sandbox.connect(request.sandboxId, { apiKey: options.apiKey, timeoutMs });
      try {
        const session = await wrap(native, request.abortSignal);
        request.abortSignal?.throwIfAborted();
        return { session };
      } catch (error) {
        // A failed reattach must preserve the existing files for another try.
        try { await native.pause(); } catch (cleanup) { throw new AggregateError([error, cleanup], `E2B resume cleanup failed for ${native.sandboxId}`); }
        throw error;
      }
    },
  };
}
