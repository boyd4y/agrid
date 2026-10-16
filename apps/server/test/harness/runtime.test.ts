import assert from "node:assert/strict";
import { test } from "node:test";
import { Sandbox } from "railway";
import type { NativeAgent } from "../../src/harness/runtime.js";
import { listRuntimeProviders } from "../../src/business/agent/sandbox-configuration.js";
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
test("Railway gate rejects creation and every open/resume path before provider calls", async t => {
  const env = { RAILWAY_API_TOKEN: "fixture", RAILWAY_SANDBOX_ENVIRONMENT_ID: "dedicated-fixture",
    OPENAI_API_KEY: "fixture", ANTHROPIC_API_KEY: "fixture" };
  const create = t.mock.method(Sandbox, "create", async () => { throw new Error("unexpected allocation"); });
  const connect = t.mock.method(Sandbox, "connect", async () => { throw new Error("unexpected lookup"); });
  for (const harness of ["codex", "claude"] as const) {
    assert.throws(() => createNativeAgent({ ...options, harness, mode: "sandbox", provider: "railway", env }), /运行组合暂不可用/);
    assert.throws(() => createNativeAgent({ ...options, harness, mode: "sandbox", env: { ...env, SANDBOX_PROVIDER: "railway" } }), /运行组合暂不可用/);
  }
  for (const harnessId of ["codex", "claude", "claude-code"]) {
    const template = t.mock.fn(async () => { throw new Error("unexpected bootstrap"); });
    // Only the public identity/template surface is needed before admission.
    const agent = { harnessId, getSandboxTemplate: template } as unknown as NativeAgent;
    const hint = listRuntimeProviders(env, harnessId).find(entry => entry.id === "railway")!.hint;
    for (const state of [{ hasResumeState: false }, { hasResumeState: false, sandboxCreated: true }, { hasResumeState: true, sandboxCreated: true }]) {
      await assert.rejects(openNativeSandbox({ agent, mode: "sandbox", provider: "railway", sandboxId: "existing-resource", ...state, env }),
        error => error instanceof Error && error.message === `railway 运行环境不可用：${hint}`);
    }
    assert.equal(template.mock.callCount(), 0);
  }
  assert.equal(create.mock.callCount(), 0);
  assert.equal(connect.mock.callCount(), 0);
});

test("an existing Railway handle can still stop and destroy after admission is denied", async t => {
  let destroyed = 0;
  const native = { id: "existing-resource", status: "RUNNING", domains: [],
    exec: async () => ({ exitCode: 0, stdout: "/workspace\n", stderr: "" }),
    heartbeat: async () => {}, destroy: async () => { destroyed++; },
  } as unknown as Sandbox;
  const create = t.mock.method(Sandbox, "create", async () => { throw new Error("must not allocate"); });
  const connect = t.mock.method(Sandbox, "connect", async () => native);
  const env = { RAILWAY_API_TOKEN: "fixture", RAILWAY_SANDBOX_ENVIRONMENT_ID: "dedicated-fixture",
    PI_API_KEY: "fixture", PI_BASE_URL: "http://127.0.0.1/v1", PI_MODEL: "fixture" };
  const agent = createNativeAgent({ ...options, harness: "pi", mode: "sandbox", provider: "railway", env });
  const { sandbox } = await openNativeSandbox({ agent, mode: "sandbox", provider: "railway", sandboxId: native.id, hasResumeState: true, env });
  try {
    assert.equal(listRuntimeProviders(env, "codex").find(entry => entry.id === "railway")!.available, false);
    await sandbox.stop();
    assert.equal(destroyed, 0);
  } finally { await sandbox.destroy(); }
  assert.equal(destroyed, 1);
  assert.equal(create.mock.callCount(), 0);
  assert.equal(connect.mock.callCount(), 1);
});

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
