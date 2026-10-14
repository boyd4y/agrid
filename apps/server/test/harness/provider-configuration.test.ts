import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { InMemoryFs } from "just-bash";
import { createHarnessAgent } from "@tabdo/platform-node/harness/agent";
import { createPiAdapter } from "@tabdo/platform-node/harness/pi";
import { createLocalSandboxAdapter } from "@tabdo/platform-node/sandbox/local";
import { resolveNativeConfiguration } from "@tabdo/backend/agent/runtime-configuration";

function provider(baseUrl: string, overrides: Record<string, string> = {}) {
  const configuration = resolveNativeConfiguration({ harness: "pi", mode: "local", env: {
    PI_API_KEY: "fixture-key", PI_BASE_URL: baseUrl, PI_MODEL: "deepseek-flash", PI_CONTEXT_WINDOW: "1048576", ...overrides,
  } });
  assert.equal(configuration.harness, "pi");
  if (configuration.harness !== "pi") throw new Error("Expected Pi configuration");
  return configuration.adapter;
}

test("DeepSeek direct endpoints use the documented token field and explicitly disable thinking", () => {
  for (const url of ["https://api.deepseek.com", "https://api.deepseek.com/v1", "https://API.DEEPSEEK.COM/v1/"]) {
    const configuration = provider(url);
    assert.equal(configuration.maxTokensField, "max_tokens");
    assert.deepEqual(configuration.samplingParams, { thinking: { type: "disabled" } });
    assert.equal(configuration.model.reasoning, false);
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
  const openRouter = provider("https://api.deepseek.com/v1", { OPENROUTER_API_KEY: "fixture-openrouter", OPENROUTER_MODEL: "openrouter/free" });
  assert.equal(openRouter.providerId, "openrouter");
  assert.equal(openRouter.apiKey, "fixture-openrouter");
  assert.equal(openRouter.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(openRouter.maxTokensField, "max_tokens");
  assert.deepEqual(openRouter.samplingParams, { reasoning: { enabled: false, effort: "none" } });
});

test("native Pi sends DeepSeek non-thinking protocol fields to a local fixture provider", { timeout: 20000 }, async () => {
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
  const fs = new InMemoryFs();
  await fs.mkdir("/project", { recursive: true });
  let sandbox: Awaited<ReturnType<ReturnType<typeof createLocalSandboxAdapter>["create"]>> | undefined;
  try {
    sandbox = await createLocalSandboxAdapter({ cwd: "/project", env: {}, createFilesystem: async () => fs }).create({ sandboxId: "deepseek-protocol-fixture" });
    // Resolve the real provider policy, replacing only its network destination so
    // the actual native SDK exercises serialization without a paid API request.
    const configuration = provider("https://api.deepseek.com/v1");
    const agent = createHarnessAgent(createPiAdapter({ ...configuration, baseUrl: `http://127.0.0.1:${address.port}/v1` }), {
      instructions: "Respond to the user.", sandboxConfig: { workDir: "work" }, tools: {},
    });
    const session = await agent.createSession({ sandboxSession: sandbox.session, sessionId: "deepseek-protocol-fixture" });
    try {
      assert.equal((await agent.generate({ session, prompt: "Verify protocol." })).text, "Protocol verified.");
      assert.equal(requests.length, 1);
      assert.equal(requests[0].model, "deepseek-flash");
      assert.equal(requests[0].max_tokens, 16384);
      assert.equal(Object.hasOwn(requests[0], "max_completion_tokens"), false);
      assert.deepEqual(requests[0].thinking, { type: "disabled" });
    } finally { await session.stop(); await session.destroy(); }
  } finally {
    await sandbox?.session.destroy();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
