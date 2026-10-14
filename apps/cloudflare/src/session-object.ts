import { createPlatformSessionServices } from "@tabdo/backend/services/sessions";
import { ServiceError } from "@tabdo/backend/errors";
import { CoordinationError,type ExecutionReference,type SessionServices } from "./contracts.js";
import { createSessionCoordinator } from "./coordinator.js";
import type { AcquireProductScope } from "./product-scope.js";

export function createProductSessionServices<Env>(env: Env,options: Readonly<{
  acquire: AcquireProductScope<Env>;
  stopCompute(env: Env,reference: ExecutionReference): Promise<void>;
}>): SessionServices {
  const platform = createPlatformSessionServices(() => options.acquire(env));
  const mapError = (error: unknown): never => {
    const status = error instanceof ServiceError ? error.status : 503;
    if ([400,401,403,404,409].includes(status)) throw new CoordinationError("Session access denied",status as 400|401|403|404|409);
    throw new CoordinationError("Session service unavailable",503);
  };
  return {
    readOutput: input => platform.readOutput(input).catch(mapError),
    async cancel(input) {
      await platform.cancel(input).catch(mapError);
      // This executes only after private authorization and durable cancellation commit.
      // Compute failure cannot undo a cancellation or expose provider diagnostics.
      await options.stopCompute(env,input.reference).catch(() => console.warn("agent.stop.pending"));
    },
  };
}

export function createProductSessionObject<Env>(options: Readonly<{
  acquire: AcquireProductScope<Env>;
  stopCompute(env: Env,reference: ExecutionReference): Promise<void>;
  pollIntervalMs?: number;
}>) {
  return createSessionCoordinator<Env>(env => createProductSessionServices(env,options),{ pollIntervalMs: options.pollIntervalMs });
}
