import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getDatabase } from "../resources/scope.js";
import { queueName } from "../queue/config.js";
import { ServiceError } from "@tabdo/backend/errors";
import type { CommandDependencies, RuntimeDependencies } from "@tabdo/backend/dependencies";

/** Node application composition. Shared business functions never access this scope. */
export function runtimeDependencies(): RuntimeDependencies {
  return { database: getDatabase(), now: () => new Date(), uuid: () => crypto.randomUUID() };
}

export function commandDependencies(): CommandDependencies {
  return { ...runtimeDependencies(), automationQueueName: queueName };
}

export function mapServiceError(error: unknown): never {
  if (error instanceof ServiceError) {
    const status = error.status as ContentfulStatusCode;
    throw new HTTPException(status, { message: error.message, cause: error.cause,
      res: Response.json({ error: error.message }, { status }) });
  }
  throw error;
}

export function backendCall<T>(work: () => Promise<T>): Promise<T> {
  return work().catch(mapServiceError);
}
