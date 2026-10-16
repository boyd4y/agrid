import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePiModelMetadata } from "../../src/harness/model-metadata.js";

test("direct model metadata validates explicit limits and never fetches a catalog", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected model catalog request"); });
  assert.deepEqual(await resolvePiModelMetadata(undefined, {}), { contextWindow: 32768, maxTokens: 16384, reasoning: false });
  assert.deepEqual(await resolvePiModelMetadata("fixture/model", { PI_CONTEXT_WINDOW: "200000", PI_MAX_OUTPUT_TOKENS: "2048" }), { contextWindow: 200000, maxTokens: 2048, reasoning: false });
  for (const value of ["invalid", "0", "-1", "1.5", "4000001"]) {
    await assert.rejects(resolvePiModelMetadata(undefined, { PI_MAX_OUTPUT_TOKENS: value }), /必须是正整数/);
    await assert.rejects(resolvePiModelMetadata(undefined, { PI_CONTEXT_WINDOW: value }), /必须是正整数/);
  }
});

test("documented DeepSeek models retain reasoning capabilities while thinking preference stays optional", async () => {
  for (const model of ["deepseek-flash", "deepseek-v4-pro"]) {
    const metadata = await resolvePiModelMetadata(model, { PI_BASE_URL: "https://api.deepseek.com/v1", PI_CONTEXT_WINDOW: "1048576" });
    assert.equal(metadata.reasoning, true);
    assert.equal(metadata.contextWindow, 1048576);
    assert.equal((await resolvePiModelMetadata(model, { PI_BASE_URL: "https://api.deepseek.com/v1", PI_THINKING_LEVEL: "off" })).reasoning, true);
  }
  assert.equal((await resolvePiModelMetadata("custom", { PI_BASE_URL: "https://other.fixture/v1" })).reasoning, false);
  assert.equal((await resolvePiModelMetadata("custom", { PI_BASE_URL: "https://other.fixture/v1", PI_THINKING_LEVEL: "low" })).reasoning, true, "an explicit non-off setting declares custom provider support");
  await assert.rejects(resolvePiModelMetadata("custom", { PI_THINKING_LEVEL: "invalid" }), /PI_THINKING_LEVEL/);
});


test("removed provider keys cannot cause catalog access or choose model metadata", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Removed provider must never be contacted"); });
  const env = { PI_API_KEY: "fixture-key", PI_BASE_URL: "https://api.deepseek.com/v1", PI_MODEL: "deepseek-flash", OPENROUTER_API_KEY: "legacy-key", OPENROUTER_MODEL: "old/model" };
  for (const old of ["openrouter/free", "openrouter/auto", "__harness_default__"]) {
    assert.deepEqual(await resolvePiModelMetadata(old, env), { contextWindow: 32768, maxTokens: 16384, reasoning: true });
  }
});
