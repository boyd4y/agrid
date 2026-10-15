import type { Redis } from "ioredis";
import { Queue, Worker, DelayedError, UnrecoverableError, type Job } from "bullmq";
import { createRedisClient, type RedisOptions } from "./redis.js";
import { parseQueueMessage, QueueDeferredError, QueuePermanentError, type QueuePublisher, type QueueDelivery, type QueueFailure } from "./index.js";

export type BullMQConfig = Readonly<{
  connection: RedisOptions;
  queueName: string;
  jobName: string;
  prefix: string;
  attempts: number;
  onError?: (error: Error) => void;
}>;
const connections = new WeakMap<object, Redis>();

export function createBullMQQueue<T>(config: BullMQConfig) {
  if (!Number.isSafeInteger(config.attempts) || config.attempts < 1) throw new Error("Invalid queue attempts");
  const connection = createRedisClient({ ...config.connection, retryStrategy: (times) => times < 2 ? 200 : null }, {
    name: `${config.prefix}:producer`, onError: config.onError,
  });
  const queue = new Queue<T, unknown, string, T, unknown, string>(config.queueName, { prefix: config.prefix, connection, defaultJobOptions: {
    attempts: config.attempts, backoff: { type: "exponential", delay: 1000, jitter: 0.5 },
    removeOnComplete: { age: 3600, count: 1000 }, removeOnFail: { age: 7 * 86400, count: 10000 },
  } });
  queue.on("error", config.onError ?? ((error) => console.error("[queue]", error.message)));
  connections.set(queue, connection);
  return queue;
}

export type BullMQWorkerConfig<T> = BullMQConfig & Readonly<{
  workerConnection: RedisOptions;
  concurrency: number;
  globalConcurrency: number;
  lockDuration: number;
  stalledInterval: number;
  maxStalledCount?: number;
  process(delivery: QueueDelivery<T>): Promise<void>;
  onFailed?(failure: QueueFailure<T>): Promise<void> | void;
}>;

/** Own BullMQ startup, delayed delivery, retry exhaustion, failure notifications and drain. */
export function createBullMQWorker<T>(config: BullMQWorkerConfig<T>) {
  for (const value of [config.concurrency, config.globalConcurrency, config.lockDuration, config.stalledInterval])
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Invalid queue worker limits");
  const settings = createBullMQQueue<T>(config);
  const delivery = (job: Job<T>, failed = false): QueueDelivery<T> => ({
    id: job.id!, body: job.data, attempt: Math.max(1, job.attemptsMade + (failed ? 0 : 1)), attempts: job.opts.attempts ?? 1,
  });
  const onError = config.onError ?? ((error: Error) => console.error("[queue:worker]", error.message));
  const worker = new Worker<T>(config.queueName, async (job, token) => {
    try { await config.process(delivery(job)); }
    catch (error) {
      if (error instanceof QueueDeferredError) {
        await job.moveToDelayed(Date.now() + error.delayMs, token);
        throw new DelayedError();
      }
      if (error instanceof QueuePermanentError) throw new UnrecoverableError(error.message);
      throw error;
    }
  }, {
    prefix: config.prefix, connection: config.workerConnection, concurrency: config.concurrency, autorun: false,
    lockDuration: config.lockDuration, stalledInterval: config.stalledInterval,
    maxStalledCount: config.maxStalledCount ?? 2,
  });
  const notifications = new Set<Promise<void>>();
  worker.on("error", onError);
  worker.on("failed", (job, error) => {
    if (!job || !config.onFailed) return;
    const notification = Promise.resolve().then(() => config.onFailed!({
      delivery: delivery(job, true), error,
      terminal: error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1)
        || error.message.includes("stalled"),
    })).then(() => {}, onError);
    notifications.add(notification);
    void notification.finally(() => notifications.delete(notification));
  });
  let closing = false;
  const ready = (async () => {
    await settings.setGlobalConcurrency(config.globalConcurrency);
    await worker.waitUntilReady();
    if (!closing) void worker.run().catch(onError);
  })();
  let closed: Promise<void> | undefined;
  return {
    worker: { pause: () => worker.pause(), resume: () => worker.resume() }, ready,
    close() {
      closing = true;
      return closed ??= (async () => {
        try {
          await ready.catch(() => {});
          await worker.close();
          await Promise.all([...notifications]);
        } finally { await closeBullMQQueue(settings); }
      })();
    },
  };
}

export async function closeBullMQQueue<T>(queue: ReturnType<typeof createBullMQQueue<T>>) {
  try { await queue.close(); }
  finally { connections.get(queue)?.disconnect(); connections.delete(queue); }
}

export function createBullMQPublisher<T>(config: BullMQConfig): QueuePublisher<T> {
  let producer: ReturnType<typeof createBullMQQueue<T>> | undefined;
  return {
    async publish(message) {
      parseQueueMessage(message);
      if (message.id.includes(":")) throw new Error("BullMQ message ID must not contain a colon");
      const queue = producer ??= createBullMQQueue<T>(config);
      await queue.add(config.jobName, message.body, { jobId: message.id });
    },
    async close() {
      const queue = producer;
      producer = undefined;
      if (queue) await closeBullMQQueue(queue);
    },
  };
}
