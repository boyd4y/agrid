import { DurableObject } from "cloudflare:workers";
import {
  CoordinationError, parseCursor, parseExecutionReference,
  type AccessCredentials, type ExecutionReference, type OutputPage, type OutputRequest, type SessionServices,
} from "./contracts.js";

export interface SessionCoordinatorRpc {
  replay(input: OutputRequest): Promise<OutputPage>;
  cancel(input: Readonly<{ reference: ExecutionReference; credentials: AccessCredentials }>): Promise<void>;
}

type CoordinatorClass<Env> = new (ctx: DurableObjectState, env: Env) => DurableObject<Env> & SessionCoordinatorRpc;

/** One instance per thread. PG remains authoritative for output, permission and execution state. */
export function createSessionCoordinator<Env>(
  services: (env: Env) => SessionServices,
  options: Readonly<{ pollIntervalMs?: number; pageSize?: number }> = {},
): CoordinatorClass<Env> {
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const pageSize = options.pageSize ?? 64;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 10 || pollIntervalMs > 30000) throw new Error("Invalid polling interval");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error("Invalid output page size");

  return class SessionCoordinator extends DurableObject<Env> implements SessionCoordinatorRpc {
    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env);
      // Only reconstructable routing metadata lives in DO storage, not Run status or message history.
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS coordinator_scope (singleton INTEGER PRIMARY KEY CHECK(singleton=1), thread_id TEXT NOT NULL)");
    }

    #checkScope(threadId: string): void {
      const current = this.ctx.storage.sql.exec<{ thread_id: string }>("SELECT thread_id FROM coordinator_scope WHERE singleton=1").toArray()[0];
      if (current && current.thread_id !== threadId) throw new CoordinationError("Session scope mismatch", 409);
    }

    #bindScope(threadId: string): void {
      this.#checkScope(threadId);
      this.ctx.storage.sql.exec("INSERT OR IGNORE INTO coordinator_scope(singleton, thread_id) VALUES (1, ?)", threadId);
      this.#checkScope(threadId);
    }

    async replay(input: OutputRequest): Promise<OutputPage> {
      const reference = parseExecutionReference(input.reference);
      const after = parseCursor(input.after);
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new CoordinationError("Invalid output page size", 400);
      this.#checkScope(reference.threadId);
      const page = await services(this.env).readOutput({ reference, after, limit: input.limit, credentials: input.credentials });
      // Invalid credentials cannot reserve an instance. Recheck after the external authorization await.
      this.#bindScope(reference.threadId);
      if (page.events.length > input.limit) throw new Error("Output repository exceeded page size");
      let cursor = after;
      for (const event of page.events) {
        if (!Number.isSafeInteger(event.cursor) || event.cursor !== cursor + 1) throw new Error("Output cursor gap or duplicate");
        if (!event.chunk || typeof event.chunk.type !== "string") throw new Error("Invalid UI output chunk");
        cursor = event.cursor;
      }
      return page;
    }

    async cancel(input: Readonly<{ reference: ExecutionReference; credentials: AccessCredentials }>): Promise<void> {
      const reference = parseExecutionReference(input.reference);
      this.#checkScope(reference.threadId);
      // The platform callback persists cancellation with current permission/fence checks before returning.
      await services(this.env).cancel({ reference, credentials: input.credentials });
      this.#bindScope(reference.threadId);
    }

    async fetch(request: Request): Promise<Response> {
      if (request.method !== "GET") return new Response(null, { status: 405, headers: { allow: "GET" } });
      try {
        const url = new URL(request.url);
        const reference = parseExecutionReference({ executionId: url.searchParams.get("executionId"), runId: url.searchParams.get("runId"), threadId: url.searchParams.get("threadId") });
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
                  // SSE ids are additive; data stays the unmodified AI SDK UI message chunk.
                  controller.enqueue(encoder.encode(`id: ${cursor}\ndata: ${JSON.stringify(event.chunk)}\n\n`));
                  return;
                }
                if (page.terminal && page.events.length < pageSize) {
                  controller.enqueue(encoder.encode("data: [DONE]\n\n"));
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
                controller.enqueue(encoder.encode('data: {"type":"error","errorText":"Unable to continue the stream."}\n\n'));
                controller.close();
                stopSubscription();
              }
            }
          },
          // Closing the browser subscription never calls cancel() or stops the runner.
          cancel: stopSubscription,
        });
        return new Response(stream, { headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "connection": "keep-alive",
          "x-vercel-ai-ui-message-stream": "v1",
          "x-accel-buffering": "no",
        } });
      } catch (error) {
        if (error instanceof CoordinationError) return Response.json({ error: error.message }, { status: error.status });
        return Response.json({ error: "Unable to read execution output" }, { status: 503 });
      }
    }
  };
}
