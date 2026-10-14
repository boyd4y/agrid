import { and, eq, lte, sql } from "drizzle-orm";
import { db, type Database } from "../db/index.js";
import { fileObjects, storageGcJobs } from "../db/schema.js";
import { getStorageAdapter, type StorageDriver } from "./adapter.js";

type Identity = { organizationId: string; storageDriver: StorageDriver; storageKey: string };
export function fileGcGraceSeconds() {
  const seconds = Number(process.env.FILE_GC_GRACE_SECONDS ?? 60);
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error("Invalid FILE_GC_GRACE_SECONDS");
  return seconds;
}
export async function enqueueFileGc(database: Database, files: Identity[], availableAt = new Date(Date.now() + fileGcGraceSeconds() * 1000)) {
  if (!files.length) return [];
  return database.insert(storageGcJobs).values(files.map(file => ({ organizationId: file.organizationId, storageDriver: file.storageDriver, storageKey: file.storageKey, availableAt }))).returning({ id: storageGcJobs.id });
}
/** Shared with upload commit: GC cannot race a storage write/metadata insert. */
export async function lockFileStorage(database: Database, organizationId: string) {
  await database.execute(sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 9011))`);
}
export async function runFileGcOnce({ limit = 100 }: { limit?: number } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid GC limit");
  let done = 0, failed = 0;
  // Each job has its own transaction; SKIP LOCKED supports multiple sweepers.
  for (let i = 0; i < limit; i++) {
    const result = await db.transaction(async tx => {
      const [job] = await tx.select().from(storageGcJobs).where(and(eq(storageGcJobs.status, "pending"), lte(storageGcJobs.availableAt, new Date())))
        .orderBy(storageGcJobs.availableAt).limit(1).for("update", { skipLocked: true });
      if (!job) return "empty";
      await lockFileStorage(tx, job.organizationId);
      const [live] = await tx.select({ id: fileObjects.id }).from(fileObjects).where(and(eq(fileObjects.storageDriver, job.storageDriver), eq(fileObjects.storageKey, job.storageKey))).limit(1);
      try {
        if (!live) await getStorageAdapter(job.storageDriver).remove(job.storageKey);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as Error).name !== "NoSuchKey") {
          await tx.update(storageGcJobs).set({ availableAt: new Date(Date.now() + 60_000) }).where(eq(storageGcJobs.id, job.id));
          console.error("file.gc failed", job.id); return "failed";
        }
      }
      await tx.update(storageGcJobs).set({ status: "done" }).where(eq(storageGcJobs.id, job.id));
      return "done";
    });
    if (result === "empty") break;
    if (result === "done") done++; else failed++;
  }
  return { done, failed };
}
