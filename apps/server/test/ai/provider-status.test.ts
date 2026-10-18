import assert from "node:assert/strict";
import { test } from "node:test";
import { listHarnesses, listProviders } from "../../src/ai/model.js";
import { resolveNativeConfiguration } from "../../src/business/agent/runtime-configuration.js";

test("published runtime metadata exposes the Railway gate without enabling unavailable harnesses", () => {
  const fixture = { RAILWAY_API_TOKEN: "fixture-token", RAILWAY_SANDBOX_ENVIRONMENT_ID: "dedicated-fixture", RAILWAY_ENVIRONMENT_ID: "app-fixture",
    HARNESS_LOCAL_ENABLED: "false", E2B_API_KEY: "", VERCEL_TOKEN: "", VERCEL_OIDC_TOKEN: "",
    OPENAI_API_KEY: "fixture", ANTHROPIC_API_KEY: "fixture", PI_API_KEY: "fixture", PI_BASE_URL: "http://127.0.0.1/v1", PI_MODEL: "fixture" };
  const previous = new Map(Object.keys(fixture).map(name => [name, process.env[name]]));
  try {
    Object.assign(process.env, fixture);
    for (const harness of listHarnesses()) {
      const railway = harness.runtimeProviders.find(entry => entry.id === "railway")!;
      assert.equal(railway.available, harness.id === "pi");
      assert.equal(harness.available, harness.id === "pi");
      assert.equal(railway.reason, harness.id === "pi" ? undefined : "railway_harness_unavailable");
      assert.equal(JSON.stringify(harness).includes("fixture-token"), false);
    }
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

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
    assert.equal(fallback.provider, "pi");
    assert.equal(fallback.available, false, "retired provider credentials never enable Pi");
    assert.equal(fallback.defaultModel, "__harness_default__");
    const providers = listProviders();
    assert(providers.every(provider => provider.id !== ("openrouter" as string)));
    assert.equal(providers[0].available, false);
    assert.throws(() => resolveNativeConfiguration({ harness: "pi", mode: "local", env: process.env }), /Pi 未配置/);
    assert.equal(JSON.stringify(fallback).includes("fixture"), false);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("Pi defaults to local in development and sandbox in production when remote is available", () => {
  const fixture = { NODE_ENV: "development", HARNESS_LOCAL_ENABLED: "true", E2B_API_KEY: "fixture",
    VERCEL_OIDC_TOKEN: "", VERCEL_TOKEN: "", RAILWAY_API_TOKEN: "" };
  const previous = new Map(Object.keys(fixture).map(name => [name, process.env[name]]));
  try {
    Object.assign(process.env, fixture);
    const pi = () => listHarnesses().find(harness => harness.id === "pi")!;
    assert.equal(pi().defaultRuntime, "local");
    process.env.NODE_ENV = "production";
    assert.equal(pi().defaultRuntime, "sandbox");
    process.env.E2B_API_KEY = "";
    assert.equal(pi().defaultRuntime, "local");
    process.env.E2B_API_KEY = "fixture";
    process.env.HARNESS_LOCAL_ENABLED = "false";
    process.env.NODE_ENV = "development";
    assert.equal(pi().defaultRuntime, "sandbox");
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
