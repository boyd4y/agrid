import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createNativeAgent,
  openNativeSandbox,
} from "../../src/harness/runtime.js";

const options = {
  instructions: "Use real tools",
  tools: {},
  skills: [],
  env: {},
};
test("default E2B bridge incompatibility is rejected before sandbox allocation", async () => {
  const env = { E2B_API_KEY: "fixture", OPENAI_API_KEY: "fixture", ANTHROPIC_API_KEY: "fixture" };
  for (const harness of ["codex", "claude"] as const) {
    assert.throws(() => createNativeAgent({ ...options, harness, mode: "sandbox", provider: "e2b", env }), /默认凭证代理与此 Harness 不兼容/);
    const agent = createNativeAgent({ ...options, harness, mode: "local", env });
    agent.getSandboxTemplate = async () => { throw new Error("must reject before bootstrap/allocation"); };
    await assert.rejects(openNativeSandbox({ agent, mode: "sandbox", provider: "e2b", sandboxId: "unallocated", hasResumeState: false, env }), /默认凭证代理与此 Harness 不兼容/);
  }
});
test("native runtime refuses missing model and sandbox configuration", () => {
  assert.throws(
    () => createNativeAgent({ ...options, harness: "codex", mode: "local" }),
    /Codex 需要/,
  );
  assert.throws(
    () => createNativeAgent({ ...options, harness: "claude", mode: "local" }),
    /Claude Code 需要/,
  );
  assert.throws(
    () => createNativeAgent({ ...options, harness: "pi", mode: "local" }),
    /Pi 未配置/,
  );
  assert.throws(
    () => createNativeAgent({ ...options, harness: "pi", mode: "sandbox" }),
    /vercel 运行环境不可用/,
  );
  assert.throws(
    () =>
      createNativeAgent({
        ...options,
        harness: "pi",
        mode: "local",
        env: { PI_API_KEY: "fixture", PI_BASE_URL: "http://127.0.0.1/v1" },
      }),
    /模型 ID/,
  );
});
test("bridge adapters construct official harnesses with explicit credentials and native model ids", () => {
  const env = {
    VERCEL_TOKEN: "fixture",
    VERCEL_TEAM_ID: "fixture",
    VERCEL_PROJECT_ID: "fixture",
  };
  assert.throws(
    () =>
      createNativeAgent({ ...options, harness: "codex", mode: "sandbox", env }),
    /Codex 需要/,
  );
  assert.throws(
    () =>
      createNativeAgent({
        ...options,
        harness: "claude",
        mode: "sandbox",
        env,
      }),
    /Claude Code 需要/,
  );
  assert.equal(
    createNativeAgent({
      ...options,
      harness: "codex",
      mode: "sandbox",
      env: { ...env, OPENAI_API_KEY: "fixture" },
    }).harnessId,
    "codex",
  );
  assert.equal(
    createNativeAgent({
      ...options,
      harness: "claude",
      mode: "sandbox",
      env: { ...env, ANTHROPIC_API_KEY: "fixture" },
    }).harnessId,
    "claude-code",
  );
});
test("resuming a local native session refuses missing files instead of starting an empty history", async () => {
  const agent = createNativeAgent({
    ...options,
    harness: "pi",
    mode: "local",
    env: { PI_API_KEY: "fixture", PI_BASE_URL: "http://127.0.0.1/v1", PI_MODEL: "fixture/model" },
  });
  await assert.rejects(
    openNativeSandbox({
      agent,
      mode: "local",
      sandboxId: "fixture",
      hasResumeState: true,
    }),
    /快照缺失/,
  );
});
