import { parseExecutionRequest, type ExecutionExit, type ExecutionRequest, type ExecutionResource } from "../execution/index.js";
import { InternalAuthenticationError, verifyInternalRequest, type InternalAuthenticationOptions, type VerifiedInternalRequest } from "../internal-auth.js";

export type ExecutionSnapshot = Readonly<{
  resource: ExecutionResource;
  state: "running" | "exited" | "unknown";
  exit?: ExecutionExit;
}>;
export type ExecutionHostServices = {
  /** Atomically verify durable acceptance/idempotency before launch, including replayed requestId. */
  accept(request: ExecutionRequest, authentication: VerifiedInternalRequest): Promise<ExecutionSnapshot>;
  lookup(id: string, authentication: VerifiedInternalRequest): Promise<ExecutionSnapshot | undefined>;
  /** Persist application cancellation before asking its resource to terminate. */
  terminate(id: string, authentication: VerifiedInternalRequest): Promise<ExecutionSnapshot | undefined>;
};
export type ExecutionHttpHostOptions = {
  authentication: InternalAuthenticationOptions;
  services: ExecutionHostServices;
  path?: string;
};

export function parseExecutionSnapshot(value: unknown, expectedId: string): ExecutionSnapshot {
  if (!value || typeof value !== "object") throw new TypeError("Invalid execution response");
  const snapshot = value as Partial<ExecutionSnapshot>;
  if (!snapshot.resource || snapshot.resource.id !== expectedId || typeof snapshot.resource.provider !== "string" || !snapshot.resource.provider
    || typeof snapshot.resource.reference !== "string" || !snapshot.resource.reference || snapshot.resource.reference.length > 4096
    || !["running", "exited", "unknown"].includes(snapshot.state ?? "")) throw new TypeError("Invalid execution response");
  if (snapshot.state === "exited" && (!snapshot.exit || !(snapshot.exit.code === null || Number.isInteger(snapshot.exit.code))
    || !(snapshot.exit.signal === null || typeof snapshot.exit.signal === "string"))) throw new TypeError("Invalid execution exit");
  return snapshot as ExecutionSnapshot;
}

/** Web-standard signed control protocol. No native SDK or application persistence is imported. */
export function createExecutionHttpHost(options: ExecutionHttpHostOptions): (request: Request) => Promise<Response> {
  const path = (options.path ?? "/executions").replace(/\/$/, "");
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) throw new TypeError("Invalid execution host path");
  return async request => {
    const url = new URL(request.url);
    if (![`${path}/start`, `${path}/lookup`, `${path}/terminate`].includes(url.pathname)) return Response.json({ error: "Not found" }, { status: 404 });
    if (request.method !== "POST" || url.search) return Response.json({ error: "Invalid control request" }, { status: 400 });
    try {
      const verified = await verifyInternalRequest(request, options.authentication);
      let value: unknown;
      try { value = JSON.parse(verified.body); } catch { return Response.json({ error: "Invalid control request" }, { status: 400 }); }
      let snapshot: ExecutionSnapshot | undefined;
      let id: string;
      if (url.pathname === `${path}/start`) {
        let input: ExecutionRequest;
        try { input = parseExecutionRequest(value); } catch { return Response.json({ error: "Invalid execution request" }, { status: 400 }); }
        id = input.id;snapshot = await options.services.accept(input, verified);
      } else {
        const input = value as { id?: unknown } | null;
        if (!input || typeof input.id !== "string" || !input.id.trim() || input.id.length > 200) return Response.json({ error: "Invalid execution id" }, { status: 400 });
        id = input.id;
        snapshot = url.pathname === `${path}/lookup` ? await options.services.lookup(id, verified) : await options.services.terminate(id, verified);
      }
      if (!snapshot) return Response.json({ error: "Execution not found" }, { status: 404 });
      return Response.json(parseExecutionSnapshot(snapshot, id));
    } catch (error) {
      if (error instanceof InternalAuthenticationError) return Response.json({ error: error.message }, { status: error.status });
      // Internal failures may contain provider configuration. Return no stack/body secrets.
      return Response.json({ error: "Execution control failed" }, { status: 503 });
    }
  };
}
