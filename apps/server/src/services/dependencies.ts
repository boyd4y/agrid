import { siteCapabilities } from "../sites/capabilities.js";
import { createSystemServices } from "@tabdo/core/services";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { requirePlatformResources } from "../resources/scope.js";
import { queueName } from "../automation/jobs/config.js";
import { ServiceError } from "../business/errors.js";
import type { CommandDependencies, RuntimeDependencies } from "../business/dependencies.js";

/** Node application composition. Shared business functions never access this scope. */
export function runtimeDependencies(): RuntimeDependencies {
  const { database, background } = requirePlatformResources();
  return { database: database.db, ...createSystemServices(),
    afterCommit: (tx, key, effect) => database.afterCommit(tx, key, effect),
    ...(background ? { wakeAfterCommit: (tx, wakeup) => database.afterCommit(tx,
      `${wakeup.kind}:${"threadId" in wakeup ? wakeup.threadId : ""}`, () => background.notify(wakeup)) } satisfies Pick<RuntimeDependencies, "wakeAfterCommit"> : {}),
  };
}

export function commandDependencies(): CommandDependencies {
  return { ...runtimeDependencies(), automationQueueName: queueName, sites: siteCapabilities() };
}

export function mapServiceError(error: unknown): never {
  if (error instanceof ServiceError) {
    const status = error.status as ContentfulStatusCode;
    throw new HTTPException(status, { message: error.message, cause: error.cause,
      res: Response.json({ error: error.message }, { status }) });
  }
  throw error;
}

export function businessCall<T>(work: () => Promise<T>): Promise<T> {
  return work().catch(mapServiceError);
}
