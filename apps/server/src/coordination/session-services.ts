import { createPlatformSessionServices as createBackendSessionServices } from "@tabdo/backend/services/sessions";
import type { PlatformResources } from "../resources/scope.js";
import { backendCall } from "../services/backend-facade.js";

export type { SessionCredentials, PlatformSessionServices } from "@tabdo/backend/services/sessions";
export type SessionServiceScope = Readonly<{ resources: PlatformResources; close(): Promise<void> }>;

/** Transitional Node entry signature; backend reads receive dependencies explicitly. */
export function createPlatformSessionServices(acquire: () => Promise<SessionServiceScope>) {
  const services = createBackendSessionServices(async () => {
    const scope = await acquire();
    if (!scope.resources.auth) { await scope.close(); throw new Error("Session authentication is required"); }
    const auth = scope.resources.auth;
    return { runtime: { database: scope.resources.database.db, now: () => new Date(), uuid: () => crypto.randomUUID() },
      identity: { database: scope.resources.database.db, resolveSession: headers => auth.api.getSession({ headers }),
        logger: { warn: (event, error) => console.warn(event, error) } }, close: scope.close };
  });
  return { readOutput: (input: Parameters<typeof services.readOutput>[0]) => backendCall(() => services.readOutput(input)),
    cancel: (input: Parameters<typeof services.cancel>[0]) => backendCall(() => services.cancel(input)) };
}
