import type { UIMessageChunk } from "ai";
import { HTTPException } from "hono/http-exception";
import { withPlatformResources, type PlatformResources } from "@tabdo/backend/resources";
import { resolveActor } from "../auth/actor.js";
import { requestRunCancellation } from "../harness/runs.js";
import { readNativeExecutionOutput, type NativeExecutionReference } from "../runner/repository.js";

export type SessionCredentials = Readonly<{ cookie?: string; authorization?: string }>;
export type SessionServiceScope = Readonly<{ resources: PlatformResources; close(): Promise<void> }>;

/** Application-owned durable session service, structurally shared with every deployment coordinator. */
export interface PlatformSessionServices {
  readOutput(input: Readonly<{
    reference: NativeExecutionReference; after: number; limit: number; credentials: SessionCredentials;
  }>): Promise<{
    events: readonly Readonly<{ cursor: number; chunk: UIMessageChunk }>[];
    terminal: boolean;
    status: "accepted" | "invoking" | "settled";
  }>;
  cancel(input: Readonly<{ reference: NativeExecutionReference; credentials: SessionCredentials }>): Promise<void>;
}

/** A fresh resource scope per callback; no request DB handle is held across stream polling. */
export function createPlatformSessionServices(acquire: () => Promise<SessionServiceScope>): PlatformSessionServices {
  async function scoped<T>(credentials: SessionCredentials, work: (actor: NonNullable<Awaited<ReturnType<typeof resolveActor>>>) => Promise<T>): Promise<T> {
    const scope = await acquire();
    try {
      return await withPlatformResources(scope.resources, async () => {
        const headers = new Headers();
        if (credentials.cookie) headers.set("cookie", credentials.cookie);
        if (credentials.authorization) headers.set("authorization", credentials.authorization);
        const actor = await resolveActor(new Request("https://platform.internal/session-access", { headers }));
        if (!actor) throw new HTTPException(401, { message: "请先登录" });
        if (!actor.organizationId || !actor.memberId) throw new HTTPException(403, { message: "当前工作区不可访问" });
        return work(actor);
      });
    } finally { await scope.close(); }
  }

  const service: PlatformSessionServices = {
    readOutput(input) {
      return scoped(input.credentials, actor => readNativeExecutionOutput({
        executionId: input.reference.executionId, expected: input.reference,
        actor, after: input.after, limit: input.limit,
      }));
    },
    async cancel(input) {
      await scoped(input.credentials, async actor => {
        // Resolve the entire private reference; matching run/thread IDs alone is insufficient.
        await readNativeExecutionOutput({ executionId: input.reference.executionId, expected: input.reference, actor, after: 0, limit: 1 });
        await requestRunCancellation(input.reference.threadId, input.reference.runId, actor);
      });
    },
  };
  return Object.freeze(service);
}
