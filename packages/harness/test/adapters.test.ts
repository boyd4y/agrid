import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSandboxCompatibility } from "../src/index.js";
import { createCodexAdapter } from "../src/adapters/codex.js";
import { createClaudeCodeAdapter } from "../src/adapters/claude-code.js";
import { createPiAdapter } from "../src/adapters/pi.js";

test("native bridge adapters require explicit credentials and a network environment", () => {
  for (const create of [createCodexAdapter, createClaudeCodeAdapter]) {
    assert.throws(() => create({ apiKey: "" }), /explicit API key/);
    const adapter = create({ apiKey: "fixture", model: "native-model" });
    assert.equal(adapter.model, "native-model");
    assert.throws(() => assertSandboxCompatibility(adapter, false), /network-accessible/);
    assertSandboxCompatibility(adapter, true);
  }
  assert.throws(() => createPiAdapter({ providerId: "fixture", apiKey: "", baseUrl: "http://127.0.0.1/v1",
    model: { id: "fixture", contextWindow: 65536, maxTokens: 1024, reasoning: false }, maxTokensField: "max_tokens" }), /explicit/);
});
