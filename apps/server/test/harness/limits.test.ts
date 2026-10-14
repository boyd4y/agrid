import assert from "node:assert/strict";
import { test } from "node:test";
import { chatRunLimits, chatRequestLimits } from "../../src/harness/limits.js";

test("safe defaults and positive integer overrides", () => {
  const previous = process.env.AI_CHAT_MAX_STEPS;
  try {
    delete process.env.AI_CHAT_MAX_STEPS;
    assert.equal(chatRunLimits().steps, 40);
    for (const value of ["0", "-1", "1.5", "invalid", "Infinity"]) {
      process.env.AI_CHAT_MAX_STEPS = value;
      assert.equal(chatRunLimits().steps, 40);
    }
    process.env.AI_CHAT_MAX_STEPS = "7";
    assert.equal(chatRunLimits().steps, 7);
    assert.deepEqual(chatRunLimits().timeout, { totalMs: 600_000, stepMs: 120_000, firstChunkMs: 60_000, chunkMs: 30_000 });
    assert.equal(chatRequestLimits().maxMessagesPerRequest, 50);
  } finally {
    if (previous === undefined) delete process.env.AI_CHAT_MAX_STEPS; else process.env.AI_CHAT_MAX_STEPS = previous;
  }
});
