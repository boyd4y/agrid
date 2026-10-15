import type { LeaseKeys, LeaseProvider, QueueInspector, TaskLease } from "@tabdo/queue";
import { closeResources } from "./runtime.js";

/** The application fences candidates in its store; this worker only orchestrates delivery recovery. */
export function createDeliveryRecovery<R>(options: {
  queue: Pick<QueueInspector<unknown>, "has"> & { close(): Promise<void> };
  leases: LeaseProvider;
  claim(): Promise<R[]>;
  messageId(record: R): string;
  leaseKeys(record: R): LeaseKeys;
  recover(record: R, lease: TaskLease): Promise<number>;
}) {
  const active = new Set<Promise<number>>();
  async function scan() {
    let recovered = 0;
    for (const record of await options.claim()) {
      if (await options.queue.has(options.messageId(record))) continue;
      const lease = await options.leases.acquire(options.leaseKeys(record));
      if (!lease) continue;
      try { await lease.assertOwned(); recovered += await options.recover(record, lease); }
      finally { await lease.release(); }
    }
    return recovered;
  }
  return {
    tick() {
      const pending = scan(); active.add(pending);
      void pending.then(() => active.delete(pending), () => active.delete(pending));
      return pending;
    },
    async close() { await Promise.allSettled([...active]); await closeResources([options.queue, options.leases]); },
  };
}
