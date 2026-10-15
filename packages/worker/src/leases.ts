import type { LeaseKeys, LeaseProvider, TaskLease } from "@tabdo/queue";

export class TaskDeferredError extends Error {
  constructor(readonly delayMs: number) {
    super("Task execution deferred");
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new TypeError("Invalid task delay");
  }
}
/** Acquisition, deferral, ownership checks and release form one execution scope. */
export async function withTaskLease<T>(provider: LeaseProvider, keys: LeaseKeys,
  work: (lease: TaskLease) => Promise<T>, delayMs = 200 + Math.floor(Math.random() * 300)): Promise<T> {
  const lease = await provider.acquire(keys);
  if (!lease) throw new TaskDeferredError(delayMs);
  try { await lease.assertOwned(); return await work(lease); }
  finally { await lease.release(); }
}
