import { Queue, Worker, DelayedError, UnrecoverableError, type Job } from "bullmq";
import { createRedisClient, type RedisOptions } from "./redis.js";
import { parseQueueMessage, type QueueTransport, type QueueDelivery, type QueueConsumerOptions } from "./index.js";

export type BullMQConfig = Readonly<{
  connection: RedisOptions;
  workerConnection: RedisOptions;
  queueName: string;
  jobName: string;
  prefix: string;
  attempts: number;
  retryDelayMs?: number;
  onError?: (error: Error) => void;
}>;

/** Only this adapter knows BullMQ jobs, errors, locks and Redis connection ownership. */
export function createBullMQTransport<T>(config: BullMQConfig): QueueTransport<T> {
  for (const value of [config.attempts, config.retryDelayMs ?? 1000])
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Invalid queue retry limits");
  const publicError = (cause: unknown) => {
    const error = new Error(cause instanceof Error ? cause.message : String(cause));
    if (cause instanceof Error) error.stack = cause.stack;
    return error;
  };
  const report = (error: Error) => {
    try { (config.onError ?? ((cause) => console.error("[queue]", cause.message)))(publicError(error)); } catch { /* Observation cannot break delivery. */ }
  };
  const open = () => {
    const connection = createRedisClient({ ...config.connection, retryStrategy: (times) => times < 2 ? 200 : null }, {
      name: `${config.prefix}:producer`, onError: report,
    });
    const queue = new Queue<T, unknown, string, T, unknown, string>(config.queueName, {
      prefix: config.prefix, connection, defaultJobOptions: {
        attempts: config.attempts, backoff: { type: "exponential", delay: config.retryDelayMs ?? 1000, jitter: 0.5 },
        removeOnComplete: { age: 3600, count: 1000 }, removeOnFail: { age: 7 * 86400, count: 10000 },
      },
    });
    queue.on("error", report);
    return { queue, async close() { try { await queue.close(); } finally { connection.disconnect(); } } };
  };
  let producer: ReturnType<typeof open> | undefined;
  const resource = () => producer ??= open();
  async function inspect<R>(read: (queue: ReturnType<typeof open>["queue"]) => Promise<R>) {
    const current = resource();
    try { await current.queue.waitUntilReady(); return await read(current.queue); }
    catch (error) {
      if (producer === current) producer = undefined;
      await current.close().catch(() => {});
      throw publicError(error);
    }
  }
  function consume(options: QueueConsumerOptions<T>) {
    for (const value of [options.concurrency, options.globalConcurrency, options.lockDuration, options.stalledInterval])
      if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Invalid queue consumer limits");
    const settings = open();
    const delivery = (job: Job<T>, failed = false): QueueDelivery<T> => ({
      id: job.id!, body: job.data, attempt: Math.max(1, job.attemptsMade + (failed ? 0 : 1)), attempts: job.opts.attempts ?? 1,
    });
    const driver = new Worker<T>(config.queueName, async (job, token) => {
      const result = await options.process(delivery(job));
      if (result.type === "defer") {
        if (!Number.isFinite(result.delayMs) || result.delayMs < 0) throw new TypeError("Invalid queue delay");
        await job.moveToDelayed(Date.now() + result.delayMs, token);
        throw new DelayedError();
      }
      if (result.type === "retry") {
        if (result.permanent) throw new UnrecoverableError(result.error.message);
        throw result.error;
      }
    }, {
      prefix: config.prefix, connection: config.workerConnection, concurrency: options.concurrency, autorun: false,
      lockDuration: options.lockDuration, stalledInterval: options.stalledInterval, maxStalledCount: options.maxStalledCount ?? 2,
    });
    const notifications = new Set<Promise<void>>();
    driver.on("error", report);
    driver.on("failed", (job, error) => {
      if (!job || !options.onFailed) return;
      const notification = Promise.resolve().then(() => options.onFailed!({
        delivery: delivery(job, true), error: publicError(error),
        terminal: error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1)
          || error.message.includes("stalled"),
      })).then(() => {}, report);
      notifications.add(notification);
      void notification.finally(() => notifications.delete(notification));
    });
    let closing = false;
    const ready = (async () => {
      await settings.queue.setGlobalConcurrency(options.globalConcurrency);
      await driver.waitUntilReady();
      if (!closing) void driver.run().catch(report);
    })().catch((error) => { throw publicError(error); });
    let closed: Promise<void> | undefined;
    return {
      ready, pause: () => driver.pause(), resume: () => driver.resume(),
      close() {
        closing = true;
        return closed ??= (async () => {
          try { await ready.catch(() => {}); await driver.close(); await Promise.all([...notifications]); }
          finally { await settings.close(); }
        })();
      },
    };
  }
  return {
    consume,
    async publish(message, options) {
      parseQueueMessage(message);
      const delay = options?.delayMs ?? 0;
      if (!Number.isSafeInteger(delay) || delay < 0) throw new TypeError("Invalid queue delivery delay");
      if (message.id.includes(":")) throw new Error("BullMQ message ID must not contain a colon");
      const { queue } = resource();
      try {
        await queue.waitUntilReady();
        await queue.add(config.jobName, message.body, { jobId: message.id, delay });
      } catch (error) { throw publicError(error); }
    },
    has: (id) => inspect(async (queue) => Boolean(await queue.getJob(id))),
    get: (id) => inspect(async (queue) => {
      const job = await queue.getJob(id);
      return job ? { id: job.id!, body: job.data, state: await job.getState() } : undefined;
    }),
    status: () => inspect(async (queue) => ({
      name: queue.name, counts: await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed"),
      globalConcurrency: await queue.getGlobalConcurrency(),
    })),
    remove: (id) => inspect(async (queue) => { await (await queue.getJob(id))?.remove(); }),
    async close() {
      const current = producer; producer = undefined;
      await current?.close();
    },
  };
}
