import assert from "node:assert/strict";
import { test } from "node:test";
import { listHarnesses } from "../../src/ai/model.js";
import { resolveNativeConfiguration } from "../../src/business/agent/runtime-configuration.js";

test("Node status follows the same complete provider selection as native Pi", () => {
  const previous = new Map(["PI_API_KEY", "PI_BASE_URL", "PI_MODEL", "OPENROUTER_API_KEY", "OPENROUTER_MODEL"].map(name => [name, process.env[name]]));
  try {
    Object.assign(process.env, { PI_API_KEY: "direct-fixture", PI_BASE_URL: "https://api.deepseek.com/v1", PI_MODEL: "deepseek-flash", OPENROUTER_API_KEY: "legacy-fixture", OPENROUTER_MODEL: "router/model" });
    const direct = listHarnesses().find(harness => harness.id === "pi")!;
    assert.equal(direct.provider, "pi");
    assert.equal(direct.defaultModel, "deepseek-flash");
    const selected = resolveNativeConfiguration({ harness: "pi", mode: "local", env: process.env });
    assert.equal(selected.harness, "pi"); if (selected.harness !== "pi") throw new Error("Expected Pi");
    assert.equal(selected.adapter.model.id, direct.defaultModel);
    process.env.PI_API_KEY = "";
    const fallback = listHarnesses().find(harness => harness.id === "pi")!;
    assert.equal(fallback.provider, "openrouter");
    assert.equal(fallback.defaultModel, "router/model");
    assert.equal(JSON.stringify(fallback).includes("fixture"), false);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
