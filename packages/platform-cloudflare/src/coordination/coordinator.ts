import { DurableObject } from "cloudflare:workers";
import {
  CoordinationError, parseCursor,
  type AccessCredentials, type OutputPage, type OutputRequest, type SessionServices,
} from "./contracts.js";

export interface SessionCoordinatorRpc<Reference, Chunk, State = unknown> {
  replay(input: OutputRequest<Reference>): Promise<OutputPage<Chunk, State>>;
  cancel(input: Readonly<{ reference: Reference; credentials: AccessCredentials }>): Promise<void>;
}

export type CoordinatorRouting<Reference> = Readonly<{
  parseReference(value: unknown): Reference;
  scopeKeyOf(reference: Reference): string;
  referenceFromRequest(request: Request): unknown;
  headers?: HeadersInit;
  errorFrame?: string;
  endFrame?: string;
}>;

export type CoordinatorClass<Env, Reference, Chunk, State> = new (ctx: DurableObjectState, env: Env) => DurableObject<Env> & SessionCoordinatorRpc<Reference, Chunk, State>;

/** One instance per application scope. Its authenticated service remains the state authority. */
export function createSessionCoordinator<Env, Reference, Chunk, State = unknown>(
  services: (env: Env) => SessionServices<Reference, Chunk, State>,
  routing: CoordinatorRouting<Reference>,
  options: Readonly<{ pollIntervalMs?: number; pageSize?: number }> = {},
): CoordinatorClass<Env, Reference, Chunk, State> {
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const pageSize = options.pageSize ?? 64;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 10 || pollIntervalMs > 30000) throw new Error("Invalid polling interval");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error("Invalid output page size");

  return class SessionCoordinator extends DurableObject<Env> implements SessionCoordinatorRpc<Reference, Chunk, State> {
    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env);
      // Only reconstructable routing metadata lives here, never authoritative business state.
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS coordination_scope (singleton INTEGER PRIMARY KEY CHECK(singleton=1), scope_key TEXT NOT NULL)");
    }

    #checkScope(scopeKey: string): void {
      if (typeof scopeKey !== "string" || !scopeKey || scopeKey.length > 4096 || scopeKey.includes("\0")) throw new CoordinationError("Invalid coordination scope", 400);
      const current = this.ctx.storage.sql.exec<{ scope_key: string }>("SELECT scope_key FROM coordination_scope WHERE singleton=1").toArray()[0];
      if (current && current.scope_key !== scopeKey) throw new CoordinationError("Session scope mismatch", 409);
    }

    #bindScope(scopeKey: string): void {
      this.#checkScope(scopeKey);
      this.ctx.storage.sql.exec("INSERT OR IGNORE INTO coordination_scope(singleton, scope_key) VALUES (1, ?)", scopeKey);
      this.#checkScope(scopeKey);
    }

    async replay(input: OutputRequest<Reference>): Promise<OutputPage<Chunk, State>> {
      const reference = routing.parseReference(input.reference);
      const scopeKey = routing.scopeKeyOf(reference);
      const after = parseCursor(input.after);
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new CoordinationError("Invalid output page size", 400);
      this.#checkScope(scopeKey);
      const page = await services(this.env).readOutput({ reference, after, limit: input.limit, credentials: input.credentials });
      // Invalid credentials cannot reserve an instance. Recheck after the external authorization await.
      this.#bindScope(scopeKey);
      if (page.events.length > input.limit) throw new Error("Output repository exceeded page size");
      let cursor = after;
      for (const event of page.events) {
        if (!Number.isSafeInteger(event.cursor) || event.cursor !== cursor + 1) throw new Error("Output cursor gap or duplicate");
        cursor = event.cursor;
      }
      return page;
    }

    async cancel(input: Readonly<{ reference: Reference; credentials: AccessCredentials }>): Promise<void> {
      const reference = routing.parseReference(input.reference);
      const scopeKey = routing.scopeKeyOf(reference);
      this.#checkScope(scopeKey);
      // The platform callback persists cancellation with current permission/fence checks before returning.
      await services(this.env).cancel({ reference, credentials: input.credentials });
      this.#bindScope(scopeKey);
    }

    async fetch(request: Request): Promise<Response> {
      if (request.method !== "GET") return new Response(null, { status: 405, headers: { allow: "GET" } });
      try {
        const url = new URL(request.url);
        const reference = routing.parseReference(routing.referenceFromRequest(request));
        const after = parseCursor(request.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0);
        const credentials: AccessCredentials = Object.freeze({
          cookie: request.headers.get("cookie") ?? undefined,
          authorization: request.headers.get("authorization") ?? undefined,
        });
        let cursor = after;
        let page = await this.replay({ reference, after: cursor, limit: pageSize, credentials });
        let index = 0;
        let canceled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let wake: (() => void) | undefined;
        const encoder = new TextEncoder();
        const stopSubscription = () => {
          canceled = true;
          if (timer !== undefined) clearTimeout(timer);
          wake?.();
        };
        const stream = new ReadableStream<Uint8Array>({
          pull: async (controller) => {
            try {
              while (!canceled) {
                const event = page.events[index++];
                if (event) {
                  cursor = event.cursor;
                  // Application payloads are projected as JSON without interpreting their fields.
                  const payload = JSON.stringify(event.chunk);
                  if (typeof payload !== "string") throw new Error("Output is not a JSON payload");
                  controller.enqueue(encoder.encode(`id: ${cursor}\ndata: ${payload}\n\n`));
                  return;
                }
                if (page.terminal && page.events.length < pageSize) {
                  if (routing.endFrame) controller.enqueue(encoder.encode(routing.endFrame));
                  controller.close();
                  stopSubscription();
                  return;
                }
                if (page.events.length < pageSize) {
                  await new Promise<void>((resolve) => {
                    wake = resolve;
                    timer = setTimeout(resolve, pollIntervalMs);
                  });
                  timer = undefined;
                  wake = undefined;
                  if (canceled) return;
                }
                // Every page rechecks current membership; no credential-derived principal is cached in the DO.
                page = await this.replay({ reference, after: cursor, limit: pageSize, credentials });
                index = 0;
              }
            } catch {
              if (!canceled) {
                // Do not leak execution/provider/internal errors after HTTP headers have been sent.
                if (routing.errorFrame) {
                  controller.enqueue(encoder.encode(routing.errorFrame));
                  controller.close();
                } else controller.error(new Error("Unable to continue the output stream"));
                stopSubscription();
              }
            }
          },
          // Closing the browser subscription never calls cancel() or stops the runner.
          cancel: stopSubscription,
        });
        const headers = new Headers(routing.headers);
        headers.set("content-type", "text/event-stream");
        headers.set("cache-control", "no-cache");
        return new Response(stream, { headers });
      } catch (error) {
        if (error instanceof CoordinationError) return Response.json({ error: error.message }, { status: error.status });
        return Response.json({ error: "Unable to read execution output" }, { status: 503 });
      }
    }
  };
}
