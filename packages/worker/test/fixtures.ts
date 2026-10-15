import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createBullMQTransport } from "@tabdo/queue/bullmq";
import { createRedisClient, waitForRedisReady, redisConnectionOptions } from "@tabdo/queue/redis";
import { createRedisLeaseProvider } from "@tabdo/queue/lease";

export const redisUrl = process.env.QUEUE_ADAPTER_TEST_REDIS_URL;
export const signal = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};
export async function eventually(check: () => Promise<boolean>) {
  const deadline = Date.now() + 10000;
  while (!await check()) {
    assert(Date.now() < deadline, "task execution timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
export function fixture<T>() {
  assert.equal(new URL(redisUrl!).port, "6381", "Use the dedicated local test Redis");
  const prefix = `agrid-queue-test-worker-${randomUUID()}`;
  const connection = redisConnectionOptions(redisUrl!, "producer");
  const queue = createBullMQTransport<T>({ connection, workerConnection: redisConnectionOptions(redisUrl!, "worker"),
    queueName: "reports", jobName: "render", attempts: 2, retryDelayMs: 20, prefix });
  const leases = createRedisLeaseProvider({ connection, durationMs: 150, concurrency: 1 });
  return {
    queue, leases, prefix, connection,
    async cleanup() {
      await queue.close(); await leases.close();
      const client = createRedisClient(connection, { name: "fixture-cleanup" });
      try { await waitForRedisReady(client); const keys = await client.keys(`${prefix}:*`); if (keys.length) await client.del(...keys); }
      finally { client.disconnect(); }
    },
  };
}
