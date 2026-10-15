import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueueFailure, LeaseProvider } from "@tabdo/queue";
import { LeaseOwnershipError } from "@tabdo/queue";
import { createRedisClient } from "@tabdo/queue/redis";
import { createTaskWorker, TaskDeferredError, TaskPermanentError } from "../src/index.js";
import { withTaskLease } from "../src/leases.js";
import { fixture, redisUrl, eventually, signal } from "./fixtures.js";

const limits = { concurrency: 2, globalConcurrency: 2, lockDuration: 1000, stalledInterval: 1000 };
test("real queue worker handles concurrency, retries, deferral, permanent failure, exhaustion and repeatable drain", {
  skip: !redisUrl, timeout: 20000,
}, async () => {
  type Report = { kind: "parallel" | "retry" | "permanent" | "defer" | "exhaust" | "drain"; id: string };
  const f = fixture<Report>(), overlap = signal(), entered = signal(), finish = signal();
  const calls = new Map<string, number>(), failures: QueueFailure<Report>[] = [];
  let active = 0, peak = 0;
  const runtime = createTaskWorker({ ...limits, queue: f.queue,
    async handle(task, context) {
      const count = (calls.get(task.id) ?? 0) + 1; calls.set(task.id, count);
      if (task.body.kind === "parallel") {
        active++; peak = Math.max(peak, active);
        if (active === 2) overlap.resolve();
        await overlap.promise; active--;
      }
      if (task.body.kind === "retry" && count === 1) throw new Error("temporary report error");
      if (task.body.kind === "permanent") throw new TaskPermanentError("invalid report");
      if (task.body.kind === "exhaust") { assert.equal(context.isFinalAttempt, count === 2); throw new Error("unavailable"); }
      if (task.body.kind === "defer" && count === 1) throw new TaskDeferredError(20);
      if (task.body.kind === "defer") assert.equal(task.attempt, 1, "deferral does not spend a failure attempt");
      if (task.body.kind === "drain") { entered.resolve(); await finish.promise; }
    },
    async onFailed(failure) { failures.push(failure); },
  });
  try {
    await runtime.ready;
    for (const id of ["a", "b"]) await f.queue.publish({ id, body: { kind: "parallel", id } });
    await eventually(async () => (await f.queue.get("a"))?.state === "completed" && (await f.queue.get("b"))?.state === "completed");
    assert.equal(peak, 2);
    for (const kind of ["retry", "permanent", "defer", "exhaust"] as const)
      await f.queue.publish({ id: kind, body: { kind, id: kind } });
    await eventually(async () => (await f.queue.get("retry"))?.state === "completed"
      && (await f.queue.get("defer"))?.state === "completed" && failures.filter((f) => f.terminal).length === 2);
    assert.equal(calls.get("permanent"), 1); assert.equal(calls.get("exhaust"), 2);
    assert.equal(calls.get("retry"), 2); assert.equal(calls.get("defer"), 2);
    assert(failures.every((failure) => failure.error.constructor === Error), "provider error classes must stay inside queue");
    assert.equal(failures.find((f) => f.delivery.id === "retry")?.terminal, false);
    assert(!failures.some((f) => f.delivery.id === "defer"));
    await f.queue.publish({ id: "drain", body: { kind: "drain", id: "drain" } });
    await entered.promise;
    let drained = false;
    const close = runtime.close(); assert.equal(close, runtime.close());
    void close.then(() => { drained = true; });
    await new Promise((resolve) => setTimeout(resolve, 20)); assert.equal(drained, false);
    finish.resolve(); await close;
    assert.equal((await f.queue.get("drain"))?.state, "completed");
  } finally { finish.resolve(); overlap.resolve(); await runtime.close(); await f.cleanup(); }
});

test("worker owns lease renewal/release, shared concurrency and lost-ownership retry through a real queue", {
  skip: !redisUrl, timeout: 20000,
}, async () => {
  const f = fixture<{ report: string }>();
  const entered = signal(), finish = signal();
  const raw = createRedisClient(f.connection, { name: "lease-fixture" });
  const keys = { resourceKey: `${f.prefix}:report-lock`, groupKey: `${f.prefix}:report-group` };
  const failures: QueueFailure<{ report: string }>[] = [];
  let attempts = 0;
  const runtime = createTaskWorker({ ...limits, queue: f.queue, leases: f.leases,
    async handle(_task, context) {
      attempts++;
      const lease = await context.acquireLease(keys);
      if (attempts === 1) {
        entered.resolve(); await finish.promise; await lease.assertOwned();
      }
    },
    onFailed(failure) { failures.push(failure); },
  });
  try {
    await runtime.ready; await f.queue.publish({ id: "lease-report", body: { report: "monthly" } });
    await entered.promise;
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert(await raw.pttl(keys.resourceKey) > 0, "lease survives work longer than its original TTL");
    assert.equal(await f.leases.acquire({ resourceKey: `${f.prefix}:other-report`, groupKey: keys.groupKey }), null);
    await raw.set(keys.resourceKey, "replacement-owner", "PX", 1000);
    finish.resolve();
    await eventually(async () => failures.some((f) => f.error.message.includes("ownership lost")));
    assert.equal(await raw.get(keys.resourceKey), "replacement-owner", "stale release must not remove the new owner");
    await raw.del(keys.resourceKey);
    await eventually(async () => (await f.queue.get("lease-report"))?.state === "completed");
    assert.equal(await raw.get(keys.resourceKey), null, "worker releases its own final lease");
  } finally { finish.resolve(); await runtime.close(); raw.disconnect(); await f.cleanup(); }
});

test("scoped leases release after handler/ownership failure and defer busy resources", async () => {
  let released = 0;
  const provider: LeaseProvider = {
    async acquire() { return { async assertOwned() { throw new LeaseOwnershipError("lost"); }, async release() { released++; } }; },
    async close() {},
  };
  await assert.rejects(withTaskLease(provider, { resourceKey: "report", groupKey: "team" }, async () => assert.fail("must not execute")), /lost/);
  assert.equal(released, 1);
  provider.acquire = async () => null;
  await assert.rejects(withTaskLease(provider, { resourceKey: "report", groupKey: "team" }, async () => {}, 25),
    (error: unknown) => error instanceof TaskDeferredError && error.delayMs === 25);
});
