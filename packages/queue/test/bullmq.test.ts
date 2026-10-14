import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createBullMQPublisher, createBullMQQueue, closeBullMQQueue } from "../src/adapters/bullmq.js";

test("BullMQ carries unrelated payloads and uses caller-generated delivery IDs", {
  skip: !process.env.QUEUE_ADAPTER_TEST_REDIS_URL,
}, async () => {
  const url = new URL(process.env.QUEUE_ADAPTER_TEST_REDIS_URL!);
  assert.equal(url.port, "6381", "Use the dedicated local test Redis");
  const config = { connection: { host: url.hostname, port: 6381, maxRetriesPerRequest: 1, enableOfflineQueue: false },
    queueName: "generic-contract", jobName: "dispatch", prefix: `agrid-queue-test-adapter-${randomUUID()}`, attempts: 2 };
  type Task = { recipient: string } | { keys: string[] };
  const publisher = createBullMQPublisher<Task>(config), queue = createBullMQQueue<Task>(config);
  try {
    await queue.waitUntilReady();
    const messages = [{ id: "mail-send-1", body: { recipient: "fixture@example.test" } },
      { id: "cache-refresh-1", body: { keys: ["home"] } }];
    for (const message of messages) {
      await publisher.publish(message);
      const stored = await queue.getJob(message.id);
      assert.equal(stored?.name, "dispatch");
      assert.deepEqual(stored?.data, message.body);
    }
    await publisher.publish(messages[0]);
    assert.equal((await queue.getJobs(["wait"])).length, 2);
  } finally {
    await publisher.close?.();
    try { await queue.obliterate({ force: true }); } finally { await closeBullMQQueue(queue); }
  }
});
