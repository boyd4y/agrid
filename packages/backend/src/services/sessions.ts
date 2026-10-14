import { resolveActor, type Actor, type ActorDependencies } from "../auth/actor.js";
import { readNativeExecutionOutput, type NativeExecutionReference } from "../agent/executions.js";
import { requestRunCancellation } from "../agent/runs.js";
import type { RuntimeDependencies } from "../dependencies.js";
import { ServiceError } from "../errors.js";

export type SessionCredentials = Readonly<{ cookie?: string; authorization?: string }>;
export type SessionServiceScope = Readonly<{
  runtime: RuntimeDependencies;
  identity: ActorDependencies;
  close(): Promise<void>;
}>;

/** Each coordinator callback owns fresh resources; streaming never pins a PG connection. */
export function createPlatformSessionServices(acquire: () => Promise<SessionServiceScope>) {
  async function scoped<T>(credentials: SessionCredentials, work: (deps: RuntimeDependencies, actor: Actor) => Promise<T>): Promise<T> {
    const scope = await acquire();
    try {
      const headers = new Headers();
      if (credentials.cookie) headers.set("cookie", credentials.cookie);
      if (credentials.authorization) headers.set("authorization", credentials.authorization);
      const actor = await resolveActor(new Request("https://platform.internal/session-access", { headers }), scope.identity);
      if (!actor) throw new ServiceError(401, { message: "请先登录" });
      if (!actor.organizationId || !actor.memberId) throw new ServiceError(403, { message: "当前工作区不可访问" });
      return await work(scope.runtime, actor);
    } finally { await scope.close(); }
  }
  return Object.freeze({
    readOutput(input: Readonly<{ reference: NativeExecutionReference; after: number; limit: number; credentials: SessionCredentials }>) {
      return scoped(input.credentials, (deps, actor) => readNativeExecutionOutput(deps, {
        executionId: input.reference.executionId, expected: input.reference, actor, after: input.after, limit: input.limit,
      }));
    },
    async cancel(input: Readonly<{ reference: NativeExecutionReference; credentials: SessionCredentials }>) {
      await scoped(input.credentials, async (deps, actor) => {
        // Verify the full private execution identity before persisting cancellation.
        await readNativeExecutionOutput(deps, { executionId: input.reference.executionId, expected: input.reference, actor, after: 0, limit: 1 });
        await requestRunCancellation(deps, input.reference.threadId, input.reference.runId, actor);
      });
    },
  });
}
export type PlatformSessionServices = ReturnType<typeof createPlatformSessionServices>;
