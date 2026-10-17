import { sha256 } from "@tabdo/core/crypto";
import { eq } from "drizzle-orm";
import { blogStorageGarbage } from "../db/schema.js";
import type { CommandDependencies } from "../dependencies.js";
/** The existing file adapter accepts only opaque UUID keys. */
export async function blogStorageKey(revisionId: string, path: string) {
  const h = await sha256(`${revisionId}:${path}`);
  return `${h.slice(0, 2)}/${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
export async function collectBlogStorage(deps: CommandDependencies) {
  if (!deps.sites) return;
  const jobs = await deps.database.select().from(blogStorageGarbage).limit(10);
  for (const job of jobs) {
    try {
      const storage = deps.sites.storage(job.driver);
      for (const key of job.keys) await storage.remove(key);
      await deps.database.delete(blogStorageGarbage).where(eq(blogStorageGarbage.id, job.id));
    } catch { /* Durable plan remains available for retry. */ }
  }
}
