import type { QueueMessage, QueuePublisher } from "@tabdo/queue";
import { runBatch } from "./batch.js";

export type OutboxRecord = Readonly<{ id: string; attempts: number }>;
export interface OutboxStore<R extends OutboxRecord> {
  claim(limit: number): Promise<R[]>;
  renew(record: R): Promise<boolean>;
  markPublished(record: R): Promise<void>;
  markFailed(record: R, error: string, delayMs: number): Promise<void>;
}
export function createOutboxRelay<R extends OutboxRecord, T>(options: {
  store: OutboxStore<R>; publisher: QueuePublisher<T>; message(record: R): QueueMessage<T>;
  batchSize: number; concurrency: number;
  onError?(record: R, error: string): void;
}) {
  for (const value of [options.batchSize, options.concurrency])
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Invalid outbox relay limits");
  const active = new Set<Promise<boolean>>();
  const claim = (limit = options.batchSize) => {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("Invalid outbox batch size");
    return options.store.claim(limit);
  };
  async function send(record: R) {
    if (!await options.store.renew(record)) return false;
    try {
      await options.publisher.publish(options.message(record));
      await options.store.markPublished(record);
      return true;
    } catch (cause) {
      await options.publisher.close?.().catch(() => {});
      const error = cause instanceof Error ? cause.message : String(cause);
      const delay = Math.min(60000, 1000 * 2 ** Math.min(record.attempts - 1, 6));
      await options.store.markFailed(record, error, delay);
      try { options.onError?.(record, error); } catch { /* Observation cannot change compensation. */ }
      return false;
    }
  }
  const publish = (record: R) => {
    const result = send(record); active.add(result);
    void result.then(() => active.delete(result), () => active.delete(result));
    return result;
  };
  return {
    claim, publish,
    async tick() { return runBatch(await claim(), options.concurrency, publish); },
    async close() { await Promise.allSettled([...active]); await options.publisher.close?.(); },
  };
}
