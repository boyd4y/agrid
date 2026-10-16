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
test("native runtime refuses unsupported local adapters and missing provider/sandbox configuration", () => {
  assert.throws(
    () => createNativeAgent({ ...options, harness: "codex", mode: "local" }),
    /需要.*Sandbox/,
  );
  assert.throws(
    () => createNativeAgent({ ...options, harness: "claude", mode: "local" }),
    /需要.*Sandbox/,
  );
  assert.throws(
    () => createNativeAgent({ ...options, harness: "pi", mode: "local" }),
    /Pi 未配置/,
  );
  assert.throws(
    () => createNativeAgent({ ...options, harness: "pi", mode: "sandbox" }),
    /Sandbox 未配置/,
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
