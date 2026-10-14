import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { InMemoryFs } from "just-bash";
import { createHarnessAgent } from "@tabdo/platform-node/harness/agent";
import { createPiAdapter } from "@tabdo/platform-node/harness/pi";
import { createLocalSandboxAdapter } from "@tabdo/platform-node/sandbox/local";
import { resolveNativeConfiguration } from "@tabdo/backend/agent/runtime-configuration";

function provider(baseUrl: string, overrides: Record<string, string | undefined> = {}) {
  const configuration = resolveNativeConfiguration({ harness: "pi", mode: "local", env: {
    PI_API_KEY: "fixture-key", PI_BASE_URL: baseUrl, PI_MODEL: "deepseek-flash", PI_CONTEXT_WINDOW: "1048576", ...overrides,
  } });
  assert.equal(configuration.harness, "pi");
  if (configuration.harness !== "pi") throw new Error("Expected Pi configuration");
  return configuration.adapter;
}

test("DeepSeek direct endpoints preserve native thinking defaults and documented token fields", () => {
  for (const url of ["https://api.deepseek.com", "https://api.deepseek.com/v1", "https://API.DEEPSEEK.COM/v1/"]) {
    const configuration = provider(url);
    assert.equal(configuration.maxTokensField, "max_tokens");
    assert.equal(configuration.samplingParams, undefined);
    assert.equal(configuration.thinkingLevel, undefined);
    assert.equal(configuration.model.reasoning, true);
    assert.equal(configuration.model.contextWindow, 1048576);
    assert.equal(configuration.model.maxTokens, 16384);
  }
  assert.equal(provider("https://api.deepseek.com/v1", { PI_MAX_OUTPUT_TOKENS: "2048" }).model.maxTokens, 2048);
});

test("DeepSeek protocol changes do not leak to other hosts or OpenRouter", () => {
  for (const url of ["https://other.fixture/v1", "https://api.deepseek.com.evil.test/v1", "https://sub.api.deepseek.com/v1", "https://api.deepseek.com@other.fixture/v1"]) {
    const configuration = provider(url);
    assert.equal(configuration.maxTokensField, "max_completion_tokens");
    assert.equal(configuration.samplingParams, undefined);
  }
  const openRouter = provider("https://api.deepseek.com/v1", { PI_API_KEY: "", OPENROUTER_API_KEY: "fixture-openrouter", OPENROUTER_MODEL: "openrouter/free" });
  assert.equal(openRouter.providerId, "openrouter");
  assert.equal(openRouter.apiKey, "fixture-openrouter");
  assert.equal(openRouter.model.id, "openrouter/free", "an unused PI_MODEL must not leak into OpenRouter defaults");
  assert.equal(openRouter.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(openRouter.maxTokensField, "max_tokens");
  assert.equal(openRouter.samplingParams, undefined);
});

test("native Pi retains its default medium reasoning effort with a local fixture provider", { timeout: 20000 }, async t => {
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.headers.authorization, "Bearer fixture-key");
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    response.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({
      id: "deepseek-protocol-fixture", object: "chat.completion.chunk", created: 1, model: "deepseek-flash", choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    send({ role: "assistant", content: "Protocol verified." });
    send({}, "stop");
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  const networkFetch = globalThis.fetch;
  // Preserve the real hostname so the native SDK exercises its DeepSeek policy;
  // only the transport is redirected, with every unexpected destination denied.
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    assert.equal(url.origin, "https://api.deepseek.com", "fixture must never make an external model request");
    url.protocol = "http:"; url.hostname = "127.0.0.1"; url.port = String(address.port);
    return networkFetch(new Request(url, request));
  });
  const fs = new InMemoryFs();
  await fs.mkdir("/project", { recursive: true });
  let sandbox: Awaited<ReturnType<ReturnType<typeof createLocalSandboxAdapter>["create"]>> | undefined;
  try {
    sandbox = await createLocalSandboxAdapter({ cwd: "/project", env: {}, createFilesystem: async () => fs }).create({ sandboxId: "deepseek-protocol-fixture" });
    const configuration = provider("https://api.deepseek.com/v1");
    const agent = createHarnessAgent(createPiAdapter(configuration), {
      instructions: "Respond to the user.", sandboxConfig: { workDir: "work" }, tools: {},
    });
    const session = await agent.createSession({ sandboxSession: sandbox.session, sessionId: "deepseek-protocol-fixture" });
    try {
      assert.equal((await agent.generate({ session, prompt: "Verify protocol." })).text, "Protocol verified.");
      assert.equal(requests.length, 1);
      assert.equal(requests[0].model, "deepseek-flash");
      assert.equal(requests[0].max_tokens, 16384);
      assert.equal(Object.hasOwn(requests[0], "max_completion_tokens"), false);
      assert.deepEqual(requests[0].thinking, { type: "enabled" });
      assert.equal(requests[0].reasoning_effort, "medium");
    } finally { await session.stop(); await session.destroy(); }
  } finally {
    await sandbox?.session.destroy();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});


test("Pi thinking level validates every SDK enum and disables providers only on explicit off", () => {
  for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
    const configuration = provider("https://api.deepseek.com/v1", { PI_THINKING_LEVEL: level });
    assert.equal(configuration.thinkingLevel, level);
    assert.deepEqual(configuration.samplingParams, level === "off" ? { thinking: { type: "disabled" } } : undefined);
  }
  const off = provider("https://api.deepseek.com/v1", { PI_API_KEY: "", OPENROUTER_API_KEY: "fixture-only", PI_THINKING_LEVEL: "off" });
  assert.deepEqual(off.samplingParams, { reasoning: { enabled: false, effort: "none" } });
  for (const level of ["enabled", "ultra", "invalid", "LOW"]) assert.throws(() => provider("https://api.deepseek.com/v1", { PI_THINKING_LEVEL: level }), /PI_THINKING_LEVEL/);
  assert.equal(provider("https://api.deepseek.com/v1", { PI_THINKING_LEVEL: " " }).thinkingLevel, undefined);
  assert.equal(provider("https://other.fixture/v1").model.reasoning, false, "an unknown endpoint is not invented as reasoning-capable");
});


test("complete explicit Pi credentials win as a unit over a legacy OpenRouter key", () => {
  const selected = provider("https://api.deepseek.com/v1", { OPENROUTER_API_KEY: "old-router", OPENROUTER_MODEL: "old/model" });
  assert.equal(selected.providerId, "tabdo-pi");
  assert.equal(selected.apiKey, "fixture-key");
  assert.equal(selected.baseUrl, "https://api.deepseek.com/v1");
  assert.equal(selected.model.id, "deepseek-flash");
  assert.equal(selected.model.reasoning, true);
  for (const partial of [{ PI_API_KEY: "" }, { PI_BASE_URL: "" }]) {
    const fallback = provider("https://api.deepseek.com/v1", { ...partial, OPENROUTER_API_KEY: "old-router", OPENROUTER_MODEL: "router/model" });
    assert.equal(fallback.providerId, "openrouter");
    assert.equal(fallback.apiKey, "old-router");
    assert.equal(fallback.model.id, "router/model");
  }
  assert.throws(() => provider("https://api.deepseek.com/v1", { PI_MODEL: "", OPENROUTER_API_KEY: "old-router", OPENROUTER_MODEL: "router/model" }), /需要配置模型 ID/, "complete direct credentials cannot borrow the other provider's model");
});
