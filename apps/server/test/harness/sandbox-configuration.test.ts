import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRuntimeProviderAvailable, listRuntimeProviders, resolveRuntimeProvider } from "../../src/business/agent/sandbox-configuration.js";

test("Sandbox providers require their own complete credentials and a dedicated Railway environment", () => {
  assert.equal(resolveRuntimeProvider("sandbox", undefined, {}), "vercel");
  assert.equal(resolveRuntimeProvider("sandbox", undefined, { SANDBOX_PROVIDER: "railway" }), "railway");
  assert.equal(resolveRuntimeProvider("local", "railway", { SANDBOX_PROVIDER: "invalid" }), "local");
  assert.throws(() => resolveRuntimeProvider("sandbox", undefined, { SANDBOX_PROVIDER: "invalid" }), /SANDBOX_PROVIDER/);
  for (const env of [{}, { RAILWAY_TOKEN: "project-token", RAILWAY_SANDBOX_ENVIRONMENT_ID: "test-environment" },
    { RAILWAY_API_TOKEN: "account-token", RAILWAY_ENVIRONMENT_ID: "production-auto-injected" }]) {
    assert.throws(() => assertRuntimeProviderAvailable("railway", env), /RAILWAY_SANDBOX_ENVIRONMENT_ID/);
    assert.equal(listRuntimeProviders(env).find(entry => entry.id === "railway")?.available, false);
  }
  assertRuntimeProviderAvailable("railway", { RAILWAY_API_TOKEN: "account-token", RAILWAY_SANDBOX_ENVIRONMENT_ID: "test-environment" });
  assertRuntimeProviderAvailable("e2b", { E2B_API_KEY: "fixture" }, "pi");
  for (const harness of ["codex", "claude", "claude-code"]) {
    assert.throws(() => assertRuntimeProviderAvailable("e2b", { E2B_API_KEY: "fixture" }, harness), /默认凭证代理与此 Harness 不兼容/);
    assert.equal(listRuntimeProviders({ E2B_API_KEY: "fixture" }, harness).find(entry => entry.id === "e2b")?.available, false);
  }
  assert.throws(() => assertRuntimeProviderAvailable("railway", { RAILWAY_API_TOKEN: "account-token", RAILWAY_SANDBOX_ENVIRONMENT_ID: "production", RAILWAY_ENVIRONMENT_ID: "production" }), /不能使用应用部署环境/);
  assert.throws(() => assertRuntimeProviderAvailable("e2b", { E2B_API_KEY: "fixture", E2B_TIMEOUT_MS: "NaN" }), /正整数/);
  assert.throws(() => assertRuntimeProviderAvailable("e2b", {}), /E2B_API_KEY/);
  assert.throws(() => assertRuntimeProviderAvailable("local", { HARNESS_LOCAL_ENABLED: "false" }), /不可用/);
  assert.equal(listRuntimeProviders({ E2B_API_KEY: "private-value" }).find(entry => entry.id === "e2b")?.available, true);
  assert(!JSON.stringify(listRuntimeProviders({ E2B_API_KEY: "private-value", RAILWAY_API_TOKEN: "other-private-value" })).includes("private-value"));
});
