import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createBullMQTransport } from "../src/bullmq.js";
import { createRedisClient, waitForRedisReady, redisConnectionOptions } from "../src/redis.js";

const url = process.env.QUEUE_ADAPTER_TEST_REDIS_URL;
function assertTestRedisUrl(value: string) {
  const endpoint = new URL(value);
  assert(["redis:", "rediss:"].includes(endpoint.protocol) && endpoint.hostname === "127.0.0.1"
    && ["6381", "16381"].includes(endpoint.port), "Use dedicated local test Redis at 127.0.0.1 on port 6381 or 16381");
}

test("transport fixture only accepts explicitly isolated local Redis endpoints without connecting", () => {
  for (const port of ["6381", "16381"]) {
    assert.doesNotThrow(() => assertTestRedisUrl(`redis://127.0.0.1:${port}`));
    assert.throws(() => assertTestRedisUrl(`redis://example.test:${port}`), /dedicated local test Redis/);
    assert.throws(() => assertTestRedisUrl(`redis://127.0.0.1@example.test:${port}`), /dedicated local test Redis/);
  }
  for (const endpoint of ["redis://127.0.0.1:6379", "redis://127.0.0.1", "redis://127.0.0.1:6380",
    "redis://192.168.1.2:16381", "http://127.0.0.1:16381"]) {
    assert.throws(() => assertTestRedisUrl(endpoint), /dedicated local test Redis/);
  }
});

test("transport publishes stable unrelated messages and exposes inspection without provider objects", { skip: !url }, async () => {
  assertTestRedisUrl(url!);
  const connection = redisConnectionOptions(url!, "producer");
  const prefix = `agrid-queue-test-transport-${randomUUID()}`;
  const queue = createBullMQTransport<{ recipient: string } | { keys: string[] }>({
    connection, workerConnection: redisConnectionOptions(url!, "worker"), prefix,
    queueName: "generic-contract", jobName: "dispatch", attempts: 2,
  });
  const cleanup = createRedisClient(connection, { name: "fixture-cleanup" });
  try {
    const messages = [{ id: "mail-send-1", body: { recipient: "fixture@example.test" } },
      { id: "cache-refresh-1", body: { keys: ["home"] } }];
    for (const message of messages) {
      await queue.publish(message);
      assert.deepEqual(await queue.get(message.id), { ...message, state: "waiting" });
      assert(await queue.has(message.id));
    }
    await queue.publish(messages[0]);
    assert.equal((await queue.status()).counts.waiting, 2);
    await queue.remove(messages[0].id);
    assert.equal(await queue.has(messages[0].id), false);
    assert.equal(await queue.get(messages[0].id), undefined);
    await queue.close();
    assert(await queue.has(messages[1].id), "inspection reconnects after resource reset");
    await assert.rejects(queue.publish({ id: "bad-delay", body: { keys: [] } }, { delayMs: -1 }), /delay/);
    const began = Date.now();
    await queue.publish({ id: "later", body: { keys: ["delayed"] } }, { delayMs: 300 });
    assert.equal((await queue.get("later"))?.state, "delayed");
    let receivedAt = 0;
    const consumer = queue.consume({ concurrency: 1, globalConcurrency: 1, lockDuration: 1000, stalledInterval: 1000,
      async process(message) { if (message.id === "later") receivedAt = Date.now(); return { type: "complete" }; },
    });
    try {
      await consumer.ready;
      while (!receivedAt && Date.now() - began < 5000) await new Promise(resolve => setTimeout(resolve, 20));
      assert(receivedAt - began >= 290, "delayed messages cannot run immediately");
      assert(receivedAt - began < 5000, "Redis wakes the consumer without polling a business store");
    } finally { await consumer.close(); }
  } finally {
    await queue.close();
    await waitForRedisReady(cleanup);
    const keys = await cleanup.keys(`${prefix}:*`); if (keys.length) await cleanup.del(...keys);
    cleanup.disconnect();
  }
});
