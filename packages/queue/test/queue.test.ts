import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createBullMQPublisher, createBullMQQueue, closeBullMQQueue, createBullMQWorker } from "../src/bullmq.js";
import { QueueDeferredError, QueuePermanentError, type QueueFailure } from "../src/index.js";
import { redisConnectionOptions } from "../src/redis.js";

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

test("generic consumer owns defer, transient retries, permanent failures and graceful draining", {
  skip: !process.env.QUEUE_ADAPTER_TEST_REDIS_URL, timeout: 15000,
}, async () => {
  const url = process.env.QUEUE_ADAPTER_TEST_REDIS_URL!;
  assert.equal(new URL(url).port, "6381", "Use the dedicated local test Redis");
  const config = {
    connection: redisConnectionOptions(url, "producer"), queueName: "report-tasks", jobName: "render",
    prefix: `agrid-queue-test-consumer-${randomUUID()}`, attempts: 2,
  };
  type Report = { kind: "retry" | "permanent" | "defer" | "drain"; reportId: string };
  const calls = new Map<string, number>();
  const failures: QueueFailure<Report>[] = [];
  const errors: Error[] = [];
  let entered!: () => void, finish!: () => void;
  const active = new Promise<void>((resolve) => { entered = resolve; });
  const finishWork = new Promise<void>((resolve) => { finish = resolve; });
  const runtime = createBullMQWorker<Report>({
    ...config, workerConnection: redisConnectionOptions(url, "worker"),
    concurrency: 2, globalConcurrency: 2, lockDuration: 1000, stalledInterval: 1000,
    onError: (error) => { errors.push(error); },
    async process(task) {
      const count = (calls.get(task.body.kind) ?? 0) + 1;
      calls.set(task.body.kind, count);
      if (task.body.kind === "retry" && count === 1) throw new Error("temporary report error");
      if (task.body.kind === "permanent") throw new QueuePermanentError("invalid report");
      if (task.body.kind === "defer" && count === 1) throw new QueueDeferredError(20);
      if (task.body.kind === "drain") { entered(); await finishWork; }
    },
    async onFailed(failure) { failures.push(failure); },
  });
  const publisher = createBullMQPublisher<Report>(config), queue = createBullMQQueue<Report>(config);
  async function waitFor(check: () => Promise<boolean>) {
    const deadline = Date.now() + 10000;
    while (!await check()) {
      assert(Date.now() < deadline, "queue contract timed out");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  try {
    await runtime.ready;
    for (const kind of ["retry", "permanent", "defer"] as const)
      await publisher.publish({ id: kind, body: { kind, reportId: `report-${kind}` } });
    await waitFor(async () => (await queue.getJob("retry"))?.finishedOn !== undefined
      && (await queue.getJob("defer"))?.finishedOn !== undefined
      && failures.some((failure) => failure.terminal));
    assert.equal(calls.get("permanent"), 1, "permanent failures must bypass retries");
    assert.equal(calls.get("retry"), 2);
    assert.equal(calls.get("defer"), 2);
    assert.equal(failures.find((failure) => failure.delivery.id === "retry")?.terminal, false);
    assert.equal(failures.find((failure) => failure.delivery.id === "retry")?.delivery.attempt, 1);
    assert(!failures.some((failure) => failure.delivery.id === "defer"), "deferral does not fail delivery");
    await publisher.publish({ id: "drain", body: { kind: "drain", reportId: "report-drain" } });
    await active;
    let closed = false;
    const closing = runtime.close().then(() => { closed = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(closed, false, "closing must wait for active work");
    finish(); await closing;
    assert.equal(await (await queue.getJob("drain"))?.getState(), "completed");
    assert.deepEqual(errors, []);
  } finally {
    finish(); await runtime.close(); await publisher.close?.();
    try { await queue.obliterate({ force: true }); } finally { await closeBullMQQueue(queue); }
  }
});
