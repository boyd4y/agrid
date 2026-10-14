import assert from "node:assert/strict";
import { test } from "node:test";
import { createUploadBudgets } from "../../src/storage/budgets.js";
const status = (expected: number) => (error: unknown) => (error as { status: number }).status === expected;
test("upload permits cap process and org concurrency and release idempotently", () => {
  const budgets = createUploadBudgets({ FILE_UPLOAD_MAX_CONCURRENT: "2", FILE_UPLOAD_MAX_CONCURRENT_PER_ORG: "1" });
  const first = budgets.acquire("a");
  assert.throws(() => budgets.acquire("a"), status(429));
  const second = budgets.acquire("b");
  assert.throws(() => budgets.acquire("c"), status(429));
  first.release(); first.release();
  const third = budgets.acquire("a");
  assert.throws(() => budgets.acquire("c"), status(429));
  second.release(); third.release();
});
test("quota includes pending bytes and releases reservations", () => {
  const budgets = createUploadBudgets({ FILE_STORAGE_ORG_QUOTA_BYTES: "10" });
  const first = budgets.acquire("a"), second = budgets.acquire("a");
  first.reserve(6, 2);
  assert.throws(() => second.reserve(3, 2), status(413));
  first.release(); second.reserve(8, 2); second.release();
  const unlimited = createUploadBudgets({ FILE_STORAGE_ORG_QUOTA_BYTES: "0" }).acquire("a");
  unlimited.reserve(100, 100); unlimited.release();
});
