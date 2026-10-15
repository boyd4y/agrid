import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { createNativeAgent, openNativeSandbox } from "../../src/harness/runtime.js";
import { resolvePiModelMetadata } from "../../src/harness/model-metadata.js";

test("native provider keeps its output budget when context metadata is unavailable, and respects actual catalog caps", { timeout: 20000 }, async () => {
  const requests: { max_tokens?: number; max_completion_tokens?: number }[] = [];
  const provider = createServer(async (request, response) => {
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "known/model", context_length: 200000, top_provider: { max_completion_tokens: 2048 } }] }));
      return;
    }
    let raw = ""; for await (const chunk of request) raw += chunk;
    requests.push(JSON.parse(raw));
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ id: "budget-fixture", object: "chat.completion.chunk", created: 1,
      choices: [{ index: 0, delta: { role: "assistant", content: "Local fixture completed." }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: "budget-fixture", object: "chat.completion.chunk", created: 1,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 40000, completion_tokens: 5, total_tokens: 40005 } })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address(); assert(address && typeof address !== "string");
  const env = { OPENROUTER_API_KEY: "local-budget-fixture", OPENROUTER_BASE_URL: `http://127.0.0.1:${address.port}/v1` };
  const directEnv = { PI_API_KEY: "local-direct-budget-fixture", PI_BASE_URL: env.OPENROUTER_BASE_URL };
  try {
    for (const [modelId, budget, providerEnv] of [["private/model", 16384, env], ["known/model", 2048, env], ["direct/model", 16384, directEnv]] as const) {
      const piModel = await resolvePiModelMetadata(modelId, providerEnv);
      const agent = createNativeAgent({ harness: "pi", mode: "local", modelId, piModel, env: providerEnv, skills: [], tools: {}, instructions: "Use only the local fixture." });
      const opened = await openNativeSandbox({ agent, mode: "local", sandboxId: `budget-${randomUUID()}`, hasResumeState: false, env: providerEnv });
      const session = await agent.createSession({ sessionId: `budget-${randomUUID()}`, sandboxSession: opened.sandbox });
      try {
        // Exceeds the advisory 32k fallback but fits the real provider's 200k
        // window. No user content, external model, or DB participates.
        const result = await agent.generate({ session, prompt: "x".repeat(160000) });
        assert.equal(result.text, "Local fixture completed.");
        const request = requests.at(-1)!;
        assert.equal(request.max_tokens ?? request.max_completion_tokens, budget, "estimated context must not silently replace the configured output budget with one token");
        assert.equal(Object.hasOwn(request, "max_tokens") && Object.hasOwn(request, "max_completion_tokens"), false, "send one unambiguous provider budget field");
      } finally { await session.stop(); await opened.sandbox.destroy(); }
    }
    assert.equal(requests.length, 3, "no provider retry or synthetic continuation");
  } finally { provider.closeAllConnections(); await new Promise<void>((resolve) => provider.close(() => resolve())); }
});
