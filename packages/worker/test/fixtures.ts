import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createBullMQTransport } from "@tabdo/queue/bullmq";
import { createRedisClient, waitForRedisReady, redisConnectionOptions } from "@tabdo/queue/redis";
import { createRedisLeaseProvider } from "@tabdo/queue/lease";

export const redisUrl = process.env.QUEUE_ADAPTER_TEST_REDIS_URL;
export function assertTestRedisUrl(value: string) {
  const endpoint = new URL(value);
  assert(["redis:", "rediss:"].includes(endpoint.protocol) && endpoint.hostname === "127.0.0.1"
    && ["6381", "16381"].includes(endpoint.port), "Use dedicated local test Redis at 127.0.0.1 on port 6381 or 16381");
}

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
  assertTestRedisUrl(redisUrl!);
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
