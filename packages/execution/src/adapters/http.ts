import { parseExecutionRequest, type ExecutionAdapter, type ExecutionExit, type ExecutionHandle } from "../index.js";
import { signInternalRequest, type InternalAuthenticationOptions } from "../internal-auth.js";
import { parseExecutionSnapshot, type ExecutionSnapshot } from "../transport/http-host.js";

export type HttpExecutionOptions = {
  endpoint: string;
  authentication: InternalAuthenticationOptions;
  fetch?: (request: Request) => Promise<Response>;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
};

/** Signed resource control; output/subscription and business outcomes remain caller-owned. */
export function createHttpExecution(options: HttpExecutionOptions): ExecutionAdapter {
  const endpoint = new URL(options.endpoint);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new TypeError("Invalid execution endpoint");
  if (endpoint.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) throw new TypeError("Execution endpoint must use HTTPS");
  const pollMs = options.pollIntervalMs ?? 1000, timeoutMs = options.requestTimeoutMs ?? 10_000;
  if (![pollMs, timeoutMs].every(value => Number.isSafeInteger(value) && value > 0)) throw new TypeError("Invalid execution transport bounds");
  const transport = options.fetch ?? fetch;
  let closed = false;
  const observations = new AbortController();
  const sleep = () => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, pollMs);
    const cancelled = () => { clearTimeout(timer);observations.signal.removeEventListener("abort", cancelled);reject(new Error("Execution observation closed")); };
    function done() { observations.signal.removeEventListener("abort", cancelled);resolve(); }
    observations.signal.addEventListener("abort", cancelled, { once: true });
  });
  async function request(operation: "start" | "lookup" | "terminate", input: Record<string, unknown>): Promise<ExecutionSnapshot | undefined> {
    if (closed) throw new Error("Execution adapter is closed");
    const id = input.id as string;
    const url = `${endpoint.href.replace(/\/$/, "")}/${operation}`;
    const unsigned = new Request(url, { method: "POST", body: JSON.stringify(input), headers: { "Content-Type": "application/json" },
      redirect: "error", signal: AbortSignal.any([observations.signal, AbortSignal.timeout(timeoutMs)]) });
    const signed = await signInternalRequest(unsigned, { ...options.authentication, requestId: crypto.randomUUID() });
    const response = await transport(signed);
    if (response.status === 404 && operation !== "start") return undefined;
    if (!response.ok) { await response.body?.cancel();throw new Error(`Execution control returned HTTP ${response.status}`); }
    // Bound response bytes before JSON parsing; this is control metadata, never model output.
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty execution response");
    let length = 0;const parts: Uint8Array[] = [];
    try {
      for (;;) {
        const part = await reader.read();if (part.done) break;
        length += part.value.byteLength;
        if (length > 65_536) { await reader.cancel();throw new Error("Execution response exceeds bounds"); }
        parts.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);let offset = 0;for (const part of parts) { bytes.set(part, offset);offset += part.byteLength; }
    return parseExecutionSnapshot(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), id);
  }
  function handle(initial: ExecutionSnapshot): ExecutionHandle {
    let observing: Promise<ExecutionExit> | undefined;
    const waitForExit = async () => {
      let snapshot = initial;
      for (;;) {
        if (snapshot.state === "exited") return snapshot.exit!;
        if (snapshot.state === "unknown") throw new Error("Execution resource status is unknown; do not replay work");
        if (closed) throw new Error("Execution observation closed");
        await sleep();
        const next = await request("lookup", { id: initial.resource.id });
        if (!next) throw new Error("Execution resource cannot be located; do not replay work");
        snapshot = next;
      }
    };
    return {
      resource: initial.resource,
      // Queue dispatch can await start without creating an unbounded background polling task.
      get completion() { return observing ??= waitForExit(); },
      async terminate() {
        const result = await request("terminate", { id: initial.resource.id });
        if (!result || result.state === "unknown") throw new Error("Execution termination is unknown");
        if (result.state === "exited") return result.exit!;
        return handle(result).completion;
      },
    };
  }
  return {
    async start(input) {
      const requestInput = parseExecutionRequest(input);
      const snapshot = await request("start", { id: requestInput.id, reference: requestInput.reference });
      return handle(snapshot!);
    },
    async lookup(id) { const snapshot = await request("lookup", { id });return snapshot ? handle(snapshot) : undefined; },
    async close() {
      // Closing an HTTP observer is not durable cancellation or resource termination.
      closed = true;observations.abort();
    },
  };
}
