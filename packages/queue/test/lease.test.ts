import assert from "node:assert/strict";
import { test } from "node:test";
import { acquireTaskLease } from "../src/lease.js";

test("task leases stop work after lost ownership or release, using caller-owned keys", async () => {
  let owner: string | null = "lease-a", acquisitions = 0;
  const store = {
    async eval(_script: string, _count: number, ...args: (string | number)[]) {
      assert.equal(args[0], "report-resource");assert.equal(args[1], "tenant-concurrency");
      acquisitions++;return 1;
    },
    async get() { return owner; },
  };
  const lease = await acquireTaskLease(store, { resourceKey: "report-resource", groupKey: "tenant-concurrency", token: "lease-a", durationMs: 30000, concurrency: 2, now: () => 1234 });
  assert(lease);
  try {
    await lease.assertOwned();
    owner = "lease-b";
    await assert.rejects(lease.assertOwned(), /ownership lost/);
  } finally { await lease.release(); }
  owner = "lease-a";
  await assert.rejects(lease.assertOwned(), /ownership lost/);
  assert.equal(acquisitions, 2, "acquire and fenced release only; no background renewal survives release");
});
