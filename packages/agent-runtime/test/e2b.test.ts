import assert from "node:assert/strict";
import { test } from "node:test";
import { Sandbox } from "e2b";
import { createCredentialRequestTransformation } from "@ai-sdk/harness/utils";
import { createE2BSandboxAdapter } from "../src/sandbox/e2b.js";

function fixture() {
  let pauses = 0, kills = 0;
  const native = {
    sandboxId: "real-service-id", trafficAccessToken: "private-traffic-fixture",
    commands: { run: async () => ({ stdout: "/custom/home\n" }) },
    getHost: (port: number) => `${port}-real-service-id.example.test`,
    pause: async () => { pauses++; }, kill: async () => { kills++; },
  };
  return { native: native as unknown as Sandbox, pauses: () => pauses, kills: () => kills };
}

test("E2B wraps the service ID and private endpoints; prepare receives only the restricted session", async t => {
  const f = fixture();
  const create = t.mock.method(Sandbox, "create", async () => f.native);
  const adapter = createE2BSandboxAdapter({ apiKey: "fixture", template: "custom-template" });
  let prepared = 0;
  const { session } = await adapter.create({ template: { identity: "recipe", prepare: async ({ session }) => {
    prepared++; assert(!("destroy" in session)); assert(!("setNetworkPolicy" in session));
  } } });
  assert.equal(session.id, "real-service-id"); assert.equal(session.defaultWorkingDirectory, "/custom/home");
  assert.equal(prepared, 1);
  assert.equal(create.mock.calls[0].arguments[0], "custom-template");
  assert.deepEqual(create.mock.calls[0].arguments[1], {
    apiKey: "fixture", timeoutMs: 30 * 60_000, metadata: { owner: "tabdo" }, network: { allowPublicTraffic: false },
  });
  assert.deepEqual(await session.getPortEndpoint({ port: 4000, protocol: "ws" }), {
    url: "wss://4000-real-service-id.example.test", headers: { "e2b-traffic-access-token": "private-traffic-fixture" },
  });
  await session.setPorts?.([4500]);
  await assert.rejects(async () => session.getPortEndpoint({ port: 4000 }), /not exposed/);
  assert.equal(await session.getPortUrl({ port: 4500 }), "https://4500-real-service-id.example.test");
  await session.stop(); await session.stop(); await session.destroy(); await session.destroy(); await session.stop();
  assert.equal(f.pauses(), 1); assert.equal(f.kills(), 1);
});

test("E2B lifecycle failures remain retryable and destroy also handles a paused resource", async t => {
  const f = fixture();
  t.mock.method(Sandbox, "create", async () => f.native);
  const pause = t.mock.method(f.native, "pause", async () => { throw new Error("temporary pause failure"); });
  const { session } = await createE2BSandboxAdapter({ apiKey: "fixture" }).create();
  await assert.rejects(async () => session.stop(), /temporary pause failure/);
  pause.mock.mockImplementation(async () => true);
  await session.stop(); assert.equal(pause.mock.callCount(), 2);
  const kill = t.mock.method(f.native, "kill", async () => { throw new Error("temporary kill failure"); });
  await assert.rejects(async () => session.destroy(), /temporary kill failure/);
  kill.mock.mockImplementation(async () => true);
  await session.destroy(); assert.equal(kill.mock.callCount(), 2);
});

test("E2B rejects invalid configuration and caller-assigned IDs without acquiring resources", async t => {
  const create = t.mock.method(Sandbox, "create", async () => { throw new Error("must not create"); });
  for (const settings of [{ apiKey: " " }, { apiKey: "fixture", timeoutMs: NaN }, { apiKey: "fixture", ports: [0] }])
    assert.throws(() => createE2BSandboxAdapter(settings));
  const adapter = createE2BSandboxAdapter({ apiKey: "fixture" });
  await assert.rejects(adapter.create({ sandboxId: "" }), /assigns sandbox IDs/);
  await assert.rejects(adapter.create({ abortSignal: AbortSignal.abort() }));
  assert.equal(create.mock.callCount(), 0);
});

test("E2B preparation failure and cancellation after acquisition kill the acquired resource", async t => {
  for (const cancel of [false, true]) {
    const f = fixture(), controller = new AbortController(), failure = new Error("prepare failure");
    const create = t.mock.method(Sandbox, "create", async () => { if (cancel) controller.abort(failure); return f.native; });
    await assert.rejects(createE2BSandboxAdapter({ apiKey: "fixture" }).create({ abortSignal: controller.signal,
      template: { identity: "failure", prepare: async () => { throw failure; } },
    }), error => error === failure);
    assert.equal(f.kills(), 1); assert.equal(f.pauses(), 0); create.mock.restore();
  }
});

test("E2B resume connects the exact ID, never creates a replacement, and re-pauses cancelled attachment", async t => {
  const f = fixture(), controller = new AbortController();
  const create = t.mock.method(Sandbox, "create", async () => { throw new Error("must not create"); });
  const connect = t.mock.method(Sandbox, "connect", async () => f.native);
  const adapter = createE2BSandboxAdapter({ apiKey: "fixture", timeoutMs: 12345 });
  assert.equal((await adapter.resume({ sandboxId: f.native.sandboxId })).session.id, f.native.sandboxId);
  assert.deepEqual(connect.mock.calls[0].arguments, [f.native.sandboxId, { apiKey: "fixture", timeoutMs: 12345 }]);
  connect.mock.mockImplementation(async () => { controller.abort(); return f.native; });
  await assert.rejects(adapter.resume({ sandboxId: f.native.sandboxId, abortSignal: controller.signal }));
  assert.equal(f.pauses(), 1); assert.equal(f.kills(), 0);
  connect.mock.mockImplementation(async () => { throw new Error("not found"); });
  await assert.rejects(adapter.resume({ sandboxId: "missing" }), /not found/);
  assert.equal(create.mock.callCount(), 0);
});

test("E2B cleanup errors retain both causes and the resource ID", async t => {
  const f = fixture(), original = new Error("prepare failure"), cleanup = new Error("kill failure");
  t.mock.method(f.native, "kill", async () => { throw cleanup; });
  t.mock.method(Sandbox, "create", async () => f.native);
  await assert.rejects(createE2BSandboxAdapter({ apiKey: "fixture" }).create({ template: {
    identity: "failure", prepare: async () => { throw original; },
  } }), error => error instanceof AggregateError && error.message.includes(f.native.sandboxId)
    && error.errors[0] === original && error.errors[1] === cleanup);
});

test("fixed official E2B provider rejects Harness credential header matchers without widening their scope", async t => {
  const f = fixture();
  t.mock.method(Sandbox, "create", async () => f.native);
  const { session } = await createE2BSandboxAdapter({ apiKey: "fixture" }).create();
  const matchHeaders: Record<string, string>[] = [{ Authorization: "Bearer placeholder" }, { "x-api-key": "placeholder" }];
  for (const headers of matchHeaders) {
    const transformation = createCredentialRequestTransformation({ matchUrl: "https://model.example.test/v1",
      matchHeaders: headers, transformHeaders: { Authorization: "fixture" } });
    assert(transformation.match.headers?.length, "the public Harness helper requires credential-value matching");
    await assert.rejects(async () => session.addRequestTransformations?.([transformation]), error =>
      error instanceof Error && error.name === "AI_HarnessCapabilityUnsupportedError" && error.message.includes("headers matchers are not supported"));
  }
  await session.destroy();
});
