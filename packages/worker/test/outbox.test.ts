import assert from "node:assert/strict";
import { test } from "node:test";
import { createOutboxRelay } from "../src/outbox.js";
import { createDeliveryRecovery } from "../src/recovery.js";
import { fixture, redisUrl, eventually, signal } from "./fixtures.js";

test("outbox worker publishes unrelated messages once, bounds concurrency, fences stale claims and compensates failures", async () => {
  const overlap = signal();
  const records = ["one", "two", "failed", "stale"].map((id) => ({ id, attempts: 1, token: id }));
  const ownership = new Set(records.map((r) => r.token)); ownership.delete("stale");
  const sent: string[] = [], marked: string[] = [], compensated: { id: string; delay: number }[] = [];
  let active = 0, peak = 0, closed = 0;
  const relay = createOutboxRelay({ batchSize: 4, concurrency: 2,
    store: {
      async claim() { return records; }, async renew(record) { return ownership.has(record.token); },
      async markPublished(record) { if (ownership.has(record.token)) marked.push(record.id); },
      async markFailed(record, error, delay) { assert.equal(error, "provider offline"); compensated.push({ id: record.id, delay }); },
    },
    message: (record) => ({ id: `mail-${record.id}`, body: { recipient: record.id } }),
    publisher: {
      async publish(message) {
        if (message.body.recipient === "failed") throw new Error("provider offline");
        active++; peak = Math.max(peak, active); if (active === 2) overlap.resolve();
        await overlap.promise; sent.push(message.id); active--;
      }, async close() { closed++; },
    },
    onError() { throw new Error("broken logger"); },
  });
  assert.equal(await relay.tick(), 2);
  assert.equal(peak, 2); assert.deepEqual(sent.sort(), ["mail-one", "mail-two"]);
  assert.deepEqual(marked.sort(), ["one", "two"]);
  assert.deepEqual(compensated, [{ id: "failed", delay: 1000 }]);
  assert.equal(closed, 1); await relay.close();
  assert.throws(() => relay.claim(0), /batch size/);
});

test("outbox close waits for publication and late acceptance never overwrites replacement storage ownership", async () => {
  const entered = signal(), finish = signal();
  let owner = "old", stored = "old", closed = false;
  const relay = createOutboxRelay({ batchSize: 1, concurrency: 1,
    store: {
      async claim() { return [{ id: "report", attempts: 1, token: "old" }]; },
      async renew(record) { return owner === record.token; },
      async markPublished(record) { if (owner === record.token) stored = "published"; }, async markFailed() {},
    },
    message: (record) => ({ id: record.id, body: "report" }),
    publisher: { async publish() { entered.resolve(); await finish.promise; }, async close() { closed = true; } },
  });
  const sending = relay.publish((await relay.claim())[0]); await entered.promise;
  owner = "replacement"; stored = "replacement";
  const closing = relay.close(); await Promise.resolve(); assert.equal(closed, false);
  finish.resolve(); assert.equal(await sending, true); await closing;
  assert.equal(stored, "replacement");
});

test("delivery recovery uses real queue inspection, skips existing/leased messages and releases recovered resources", {
  skip: !redisUrl, timeout: 15000,
}, async () => {
  const f = fixture<{ report: string }>(), records = ["existing", "busy", "missing"];
  const keys = (id: string) => ({ resourceKey: `${f.prefix}:${id}`, groupKey: `${f.prefix}:group-${id}` });
  let held = await f.leases.acquire(keys("busy")); assert(held);
  const recovered: string[] = [];
  const recovery = createDeliveryRecovery({ queue: f.queue, leases: f.leases,
    async claim() { return records; }, messageId: (id) => id, leaseKeys: keys,
    async recover(id, lease) { await lease.assertOwned(); recovered.push(id); return 1; },
  });
  try {
    await f.queue.publish({ id: "existing", body: { report: "existing" } });
    assert.equal(await recovery.tick(), 1); assert.deepEqual(recovered, ["missing"]);
    const released = await f.leases.acquire(keys("missing")); assert(released); await released.release();
  } finally { await held.release(); await recovery.close(); await f.cleanup(); }
});
