import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRuntimeProviderAvailable, listRuntimeProviders, resolveRuntimeProvider } from "../../src/business/agent/sandbox-configuration.js";
import { ServiceError } from "../../src/business/errors.js";

test("Railway rejects unverified harness aliases through the same metadata and assertion", () => {
  const configured = { RAILWAY_API_TOKEN: "fixture-token", RAILWAY_SANDBOX_ENVIRONMENT_ID: "dedicated-fixture" };
  const configurationHint = listRuntimeProviders({}).find(entry => entry.id === "railway")!.hint;
  for (const harness of ["codex", "claude", "claude-code"]) {
    for (const env of [configured, {}, { ...configured, RAILWAY_API_TOKEN: " " },
      { ...configured, RAILWAY_ENVIRONMENT_ID: configured.RAILWAY_SANDBOX_ENVIRONMENT_ID }]) {
      const status = listRuntimeProviders(env, harness).find(entry => entry.id === "railway")!;
      assert.equal(status.available, false);
      if (env === configured) {
        assert.equal(status.reason, "railway_harness_unavailable");
        assert.match(status.hint!, /运行组合暂不可用/);
      } else {
        assert.equal(status.reason, undefined);
        assert.equal(status.hint, configurationHint, "missing or unsafe configuration keeps its original reason");
      }
      assert.throws(() => assertRuntimeProviderAvailable("railway", env, harness), error => {
        assert(error instanceof ServiceError);
        assert.equal(error.status, 503);
        assert.equal(error.message, `railway 运行环境不可用：${status.hint}`);
        return true;
      });
    }
    for (const provider of ["local", "vercel", "e2b"] as const) {
      assert.deepEqual(listRuntimeProviders(configured, harness).find(entry => entry.id === provider),
        listRuntimeProviders({}, harness).find(entry => entry.id === provider));
    }
  }
  for (const harness of ["pi", undefined]) {
    assert.equal(listRuntimeProviders(configured, harness).find(entry => entry.id === "railway")!.available, true);
    assertRuntimeProviderAvailable("railway", configured, harness);
  }
});

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

test("sandbox defaults prefer E2B, then available providers, while explicit choices win", () => {
  const e2b = { E2B_API_KEY: "fixture", VERCEL_OIDC_TOKEN: "fixture" };
  assert.equal(resolveRuntimeProvider("sandbox", undefined, e2b), "e2b");
  assert.equal(resolveRuntimeProvider("sandbox", undefined, { VERCEL_OIDC_TOKEN: "fixture" }), "vercel");
  assert.equal(resolveRuntimeProvider("sandbox", undefined, { RAILWAY_API_TOKEN: "fixture", RAILWAY_SANDBOX_ENVIRONMENT_ID: "dedicated" }), "railway");
  assert.equal(resolveRuntimeProvider("sandbox", undefined, { ...e2b, SANDBOX_PROVIDER: "railway" }), "railway");
  assert.equal(resolveRuntimeProvider("sandbox", "vercel", { ...e2b, SANDBOX_PROVIDER: "railway" }), "vercel");
});
