import { Redis, type RedisOptions } from "ioredis";
import { Queue } from "bullmq";
import { parseQueueMessage, type QueuePublisher } from "../index.js";

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
  const connection = new Redis({ ...config.connection, connectionName: `${config.prefix}:producer`, retryStrategy: (times) => times < 2 ? 200 : null });
  const queue = new Queue<T, unknown, string, T, unknown, string>(config.queueName, { prefix: config.prefix, connection, defaultJobOptions: {
    attempts: config.attempts, backoff: { type: "exponential", delay: 1000, jitter: 0.5 },
    removeOnComplete: { age: 3600, count: 1000 }, removeOnFail: { age: 7 * 86400, count: 10000 },
  } });
  queue.on("error", config.onError ?? ((error) => console.error("[queue]", error.message)));
  connections.set(queue, connection);
  return queue;
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
