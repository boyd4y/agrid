import type { QueueDelivery, QueueFailure, QueueTransport, QueueConsumerOptions, LeaseProvider, LeaseKeys, TaskLease } from "@tabdo/queue";
import { TaskDeferredError } from "./leases.js";
import { closeResources } from "./runtime.js";

export { TaskDeferredError, withTaskLease } from "./leases.js";
export class TaskPermanentError extends Error {}
export type TaskContext = Readonly<{
  isFinalAttempt: boolean;
  acquireLease(keys: LeaseKeys): Promise<Pick<TaskLease, "assertOwned">>;
}>;
export type TaskWorkerOptions<T> = Omit<QueueConsumerOptions<T>, "process" | "onFailed"> & Readonly<{
  queue: QueueTransport<T>;
  leases?: LeaseProvider;
  handle(delivery: QueueDelivery<T>, context: TaskContext): Promise<void>;
  onFailed?(failure: QueueFailure<T>): Promise<void> | void;
}>;

/** Own task policy and injected resources; queue translates the resulting disposition. */
export function createTaskWorker<T>(options: TaskWorkerOptions<T>) {
  const consumer = options.queue.consume({
    concurrency: options.concurrency, globalConcurrency: options.globalConcurrency,
    lockDuration: options.lockDuration, stalledInterval: options.stalledInterval, maxStalledCount: options.maxStalledCount,
    onFailed: options.onFailed,
    async process(delivery) {
      const leases: TaskLease[] = [];
      try {
        try {
          await options.handle(delivery, {
            isFinalAttempt: delivery.attempt >= delivery.attempts,
            async acquireLease(keys) {
              if (!options.leases) throw new Error("Task worker has no lease provider");
              const lease = await options.leases.acquire(keys);
              if (!lease) throw new TaskDeferredError(200 + Math.floor(Math.random() * 300));
              leases.push(lease);
              await lease.assertOwned();
              return { assertOwned: () => lease.assertOwned() };
            },
          });
        } finally { await closeResources(leases.map((lease) => ({ close: () => lease.release() }))); }
        return { type: "complete" };
      } catch (cause) {
        if (cause instanceof TaskDeferredError) return { type: "defer", delayMs: cause.delayMs };
        const error = cause instanceof Error ? cause : new Error(String(cause));
        return { type: "retry", error, permanent: cause instanceof TaskPermanentError || delivery.attempt >= delivery.attempts };
      }
    },
  });
  let closing: Promise<void> | undefined;
  return {
    ready: consumer.ready, pause: () => consumer.pause(), resume: () => consumer.resume(),
    close() {
      return closing ??= (async () => {
        try { await consumer.close(); }
        finally { await closeResources([options.leases, options.queue]); }
      })();
    },
  };
}
