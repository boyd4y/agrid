import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePiModelMetadata } from "../../src/harness/model-metadata.js";

const environment = (name: string): NodeJS.ProcessEnv => ({ OPENROUTER_API_KEY: "fixture-only", OPENROUTER_BASE_URL: `https://${name}.invalid/v1` });
const response = (data: unknown) => new Response(JSON.stringify({ data }), { headers: { "Content-Type": "application/json" } });

test("catalog retains actual context/output caps, default budget, and router reasoning metadata", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return response([
      { id: "named/model", context_length: 200000, top_provider: { max_completion_tokens: 4096 }, supported_parameters: ["reasoning"] },
      { id: "openrouter/free", context_length: 200000, top_provider: { max_completion_tokens: null }, supported_parameters: ["reasoning"] },
    ]);
  });
  const env = environment("catalog-success");
  assert.deepEqual(await resolvePiModelMetadata("named/model", env), { contextWindow: 200000, maxTokens: 4096, reasoning: true });
  assert.deepEqual(await resolvePiModelMetadata("named/model", env), { contextWindow: 200000, maxTokens: 4096, reasoning: true });
  assert.equal(calls, 1, "fresh cached metadata does not fetch again");
  assert.deepEqual(await resolvePiModelMetadata("openrouter/free", env), { contextWindow: 200000, maxTokens: 16384, reasoning: false });
});

test("failed refresh reuses stale real limits without extending the catalog TTL", async (t) => {
  const clock = Date.now();
  let now = clock, calls = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => {
    if (++calls === 1) return response([{ id: "known", context_length: 128000, top_provider: { max_completion_tokens: 2048 } }]);
    throw new Error("catalog offline");
  });
  const env = environment("catalog-stale");
  const actual = await resolvePiModelMetadata("known", env);
  now += 300001;
  assert.deepEqual(await resolvePiModelMetadata("known", env), actual);
  assert.deepEqual(await resolvePiModelMetadata("known", env), actual);
  assert.equal(calls, 3, "a later request can retry the failed refresh");
});

test("missing or unavailable catalog falls back without becoming a prerequisite", async (t) => {
  let mode: "network" | "status" | "malformed" | "missing" | "found" = "network";
  t.mock.method(globalThis, "fetch", async () => {
    if (mode === "network") throw new Error("offline");
    if (mode === "status") return new Response("unavailable", { status: 503 });
    if (mode === "malformed") return response(null);
    if (mode === "missing") return response([]);
    return response([{ id: "private/model", context_length: 100000, top_provider: { max_completion_tokens: 1024 } }]);
  });
  const env = { ...environment("catalog-fallback"), PI_CONTEXT_WINDOW: "65536", PI_MAX_OUTPUT_TOKENS: "12000" };
  for (const failure of ["network", "status", "malformed", "missing"] as const) {
    mode = failure;
    assert.deepEqual(await resolvePiModelMetadata("private/model", env), { contextWindow: 65536, maxTokens: 12000, reasoning: false });
  }
  mode = "found";
  assert.deepEqual(await resolvePiModelMetadata("private/model", env), { contextWindow: 100000, maxTokens: 1024, reasoning: false }, "fallback must not hide a later actual catalog cap");
});

test("catalog timeout is short and falls back; direct configuration remains validated", async (t) => {
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    assert.equal(ms, 2000);
    return AbortSignal.abort(new DOMException("fixture timeout", "TimeoutError"));
  });
  t.mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) => {
    options?.signal?.throwIfAborted();
    throw new Error("unexpected fetch");
  });
  assert.deepEqual(await resolvePiModelMetadata("unknown", environment("catalog-timeout")), { contextWindow: 32768, maxTokens: 16384, reasoning: false });
  assert.deepEqual(await resolvePiModelMetadata(undefined, { PI_CONTEXT_WINDOW: "64000", PI_MAX_OUTPUT_TOKENS: "5000" }), { contextWindow: 64000, maxTokens: 5000, reasoning: false });
  await assert.rejects(resolvePiModelMetadata(undefined, { PI_MAX_OUTPUT_TOKENS: "invalid" }), /必须是正整数/);
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


test("explicit direct Pi metadata never queries a stale OpenRouter catalog", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("unused OpenRouter provider must not be queried"); });
  const metadata = await resolvePiModelMetadata(undefined, { PI_API_KEY: "direct-key", PI_BASE_URL: "https://api.deepseek.com/v1", PI_MODEL: "deepseek-flash",
    PI_CONTEXT_WINDOW: "1048576", OPENROUTER_API_KEY: "old-key", OPENROUTER_MODEL: "old/model" });
  assert.deepEqual(metadata, { contextWindow: 1048576, maxTokens: 16384, reasoning: true });
  assert.equal(calls, 0);
});

test("OpenRouter fallback metadata uses its own default model when direct configuration is incomplete", async t => {
  t.mock.method(globalThis, "fetch", async () => response([{ id: "router/model", context_length: 123456, supported_parameters: ["reasoning"] }]));
  const metadata = await resolvePiModelMetadata(undefined, { ...environment("selected-router-fallback"), PI_API_KEY: "", PI_BASE_URL: "https://api.deepseek.com/v1", PI_MODEL: "deepseek-flash", OPENROUTER_MODEL: "router/model" });
  assert.deepEqual(metadata, { contextWindow: 123456, maxTokens: 16384, reasoning: true });
});


test("legacy router defaults use the effective direct model for native reasoning metadata", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Direct models must not query a router catalog"); });
  const env = { PI_API_KEY: "fixture-key", PI_BASE_URL: "https://api.deepseek.com/v1", PI_MODEL: "deepseek-flash", OPENROUTER_API_KEY: "legacy-key" };
  for (const old of ["openrouter/free", "openrouter/auto", "__harness_default__"]) {
    assert.deepEqual(await resolvePiModelMetadata(old, env), { contextWindow: 32768, maxTokens: 16384, reasoning: true });
  }
});
