import { withPlatformResources, type PlatformResources } from "./scope.js";
import { nodeDatabase } from "../db/index.js";
import { createAutomationNotifier } from "../automation/jobs/notifications.js";

export const backgroundNotifications = createAutomationNotifier();

/** Node application composition. Shared business modules never import this file. */
export const nodeJobResources: PlatformResources = Object.freeze({ database: nodeDatabase, background: backgroundNotifications });

export function withNodeResources<T>(work: () => T): T {
  return withPlatformResources(nodeJobResources, work);
}

export async function createNodeHttpResources(options: { background?: boolean } = {}): Promise<PlatformResources> {
  const { auth } = await import("../auth/index.js");
  return Object.freeze({ database: nodeDatabase, auth, ...(options.background === false ? {} : { background: backgroundNotifications }) });
}
