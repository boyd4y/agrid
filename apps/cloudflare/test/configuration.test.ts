import assert from "node:assert/strict";
import { test } from "node:test";
import { piStatusConfiguration, runtimeEnvironment, type ProductEnvironment } from "../src/configuration.js";
import { resolveNativeConfiguration } from "@tabdo/backend/agent/runtime-configuration";

const direct = { PI_API_KEY: "direct-fixture", PI_BASE_URL: "https://api.deepseek.com/v1", PI_MODEL: "deepseek-flash",
  OPENROUTER_API_KEY: "legacy-fixture", OPENROUTER_MODEL: "router/model", PI_THINKING_LEVEL: "low" };

test("CF public status and execution select direct Pi despite a stale OpenRouter key", () => {
  const env = runtimeEnvironment(direct as ProductEnvironment);
  const status = piStatusConfiguration(env), configuration = resolveNativeConfiguration({ harness: "pi", mode: "local", env });
  assert.deepEqual(status, { configured: true, provider: "pi", model: "deepseek-flash" });
  assert.equal(configuration.harness, "pi"); if (configuration.harness !== "pi") throw new Error("Expected Pi");
  assert.equal(configuration.adapter.providerId, "tabdo-pi");
  assert.equal(configuration.adapter.model.id, status.model);
  assert.equal(configuration.adapter.apiKey, direct.PI_API_KEY);
  assert.equal(configuration.adapter.thinkingLevel, "low", "the runtime allowlist forwards the native setting");
  assert.equal(JSON.stringify(status).includes("fixture"), false, "public status never includes API credentials");
});

test("CF fallback status selects the same provider and default model as execution", () => {
  for (const incomplete of [{ PI_API_KEY: "" }, { PI_BASE_URL: "" }]) {
    const env = { ...direct, ...incomplete };
    const status = piStatusConfiguration(env), configuration = resolveNativeConfiguration({ harness: "pi", mode: "local", env });
    assert.deepEqual(status, { configured: true, provider: "openrouter", model: "router/model" });
    assert.equal(configuration.harness, "pi"); if (configuration.harness !== "pi") throw new Error("Expected Pi");
    assert.equal(configuration.adapter.model.id, status.model);
    assert.equal(configuration.adapter.apiKey, direct.OPENROUTER_API_KEY);
  }
  assert.deepEqual(piStatusConfiguration({ OPENROUTER_API_KEY: "  " }), { configured: false, provider: "pi", model: "__harness_default__" });
});
