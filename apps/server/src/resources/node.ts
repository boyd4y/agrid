import { withPlatformResources, type PlatformResources } from "./scope.js";
import { nodeDatabase } from "../db/index.js";

/** Node application composition. Shared business modules never import this file. */
export const nodeJobResources: PlatformResources = Object.freeze({ database: nodeDatabase });

export function withNodeResources<T>(work: () => T): T {
  return withPlatformResources(nodeJobResources, work);
}

export async function createNodeHttpResources(): Promise<PlatformResources> {
  const { auth } = await import("../auth/index.js");
  return Object.freeze({ database: nodeDatabase, auth });
}
