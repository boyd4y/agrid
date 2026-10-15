import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256 } from "../src/crypto.js";
import { schedulePreview } from "../src/tasks/schedule.js";
import { acquireTaskLease } from "../src/tasks/lease.js";

test("credential digests preserve the existing SHA-256 representation", async () => {
  assert.equal(await sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal((await sha256("用户密钥")).length, 64);
});
test("task schedules interpret IANA timezones and reject invalid cron/timezone input", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  assert.deepEqual(schedulePreview("0 9 * * *", "Asia/Shanghai", now, 1), ["2026-01-01T01:00:00.000Z"]);
  assert.throws(() => schedulePreview("H 9 * * *", "Asia/Shanghai", now));
  assert.throws(() => schedulePreview("0 9 * * *", "Not/A_Timezone", now));
});
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
