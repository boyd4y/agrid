import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256 } from "../src/crypto.js";
import { schedulePreview } from "../src/tasks/schedule.js";

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
