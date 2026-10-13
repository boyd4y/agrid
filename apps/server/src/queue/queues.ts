import { Redis } from "ioredis";
import { Queue } from "bullmq";
import { queueName, prefix, redisOptions, attempts } from "./config.js";
export type AutomationJob = { protocol: 1; eventId: string; generation: number };
const connections = new WeakMap<Queue, Redis>();
export function createQueue() {
  const connection = new Redis({ ...redisOptions(false), connectionName: `${prefix}:producer`, retryStrategy: (times) => times < 2 ? 200 : null });
  const queue = new Queue<AutomationJob>(queueName, { prefix, connection, defaultJobOptions: {
    attempts, backoff: { type: "exponential", delay: 1000, jitter: 0.5 },
    removeOnComplete: { age: 3600, count: 1000 }, removeOnFail: { age: 7 * 86400, count: 10000 },
  } });
  queue.on("error", (error) => console.error("[queue]", error.message));
  connections.set(queue, connection);
  return queue;
}
export const jobId = (id: string, generation = 0) => `automation-${id}-${generation}`;
export async function closeQueue(queue: ReturnType<typeof createQueue>) {
  // Own the producer connection so offline shutdown never depends on Redis QUIT.
  try { await queue.close(); }
  finally { connections.get(queue)?.disconnect(); connections.delete(queue); }
}
