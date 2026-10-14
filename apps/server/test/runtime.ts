import { test as nodeTest, before as nodeBefore, after as nodeAfter } from "node:test";
import { withPlatformResources } from "@tabdo/backend/resources";

async function runWithFixture<T>(work: () => T): Promise<Awaited<T>> {
  const name = new URL(process.env.DATABASE_URL ?? "").pathname;
  if (!name.endsWith("_agent_test") && !name.endsWith("_queue_test")) {
    throw new Error("Scoped integration fixtures require an isolated *_agent_test or *_queue_test database");
  }
  const { createNodeHttpResources } = await import("../src/resources/node.js");
  return await withPlatformResources(await createNodeHttpResources(), work);
}

/** Scope every test/hook explicitly; assertions still use the native test runner. */
function scopedRegistration<T extends Function>(register: T): T {
  return ((...args: unknown[]) => {
    const last = args.length - 1;
    if (typeof args[last] === "function") {
      const callback = args[last] as (...values: unknown[]) => unknown;
      args[last] = (...values: unknown[]) => runWithFixture(() => callback(...values));
    }
    return register(...args);
  }) as unknown as T;
}

export const test = scopedRegistration(nodeTest);
export const before = scopedRegistration(nodeBefore);
export const after = scopedRegistration(nodeAfter);
