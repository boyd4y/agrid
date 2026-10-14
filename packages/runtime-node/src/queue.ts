import { Redis, type RedisOptions } from "ioredis";
import { Queue } from "bullmq";
import { automationDeliveryId, parseAutomationDelivery, type AutomationDelivery, type QueuePublisher } from "@tabdo/core";

export type BullMQConfig = Readonly<{
  connection: RedisOptions;
  queueName: string;
  prefix: string;
  attempts: number;
  onError?: (error: Error) => void;
}>;
const connections = new WeakMap<Queue, Redis>();

/** Node composition provides configuration; this extension never reads environment variables. */
export function createAutomationQueue(config: BullMQConfig) {
  if (!Number.isSafeInteger(config.attempts) || config.attempts < 1) throw new Error("Invalid queue attempts");
  const connection = new Redis({ ...config.connection, connectionName: `${config.prefix}:producer`, retryStrategy: (times) => times < 2 ? 200 : null });
  const queue = new Queue<AutomationDelivery>(config.queueName, { prefix: config.prefix, connection, defaultJobOptions: {
    attempts: config.attempts, backoff: { type: "exponential", delay: 1000, jitter: 0.5 },
    removeOnComplete: { age: 3600, count: 1000 }, removeOnFail: { age: 7 * 86400, count: 10000 },
  } });
  queue.on("error", config.onError ?? ((error) => console.error("[queue]", error.message)));
  connections.set(queue, connection);
  return queue;
}

export async function closeAutomationQueue(queue: ReturnType<typeof createAutomationQueue>) {
  try { await queue.close(); }
  finally { connections.get(queue)?.disconnect(); connections.delete(queue); }
}

export function createAutomationPublisher(config: BullMQConfig): QueuePublisher<AutomationDelivery> {
  let producer: ReturnType<typeof createAutomationQueue> | undefined;
  return {
    async publish(input) {
      const delivery = parseAutomationDelivery(input);
      const queue = producer ??= createAutomationQueue(config);
      await queue.add("execute", delivery, { jobId: automationDeliveryId(delivery) });
    },
    async close() {
      const queue = producer;
      producer = undefined;
      if (queue) await closeAutomationQueue(queue);
    },
  };
}
