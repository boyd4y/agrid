import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { HarnessAgent, type HarnessAgentResumeSessionState } from "@ai-sdk/harness/agent";
import type { HarnessV1, HarnessV1Session } from "@ai-sdk/harness";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { executeNativeRun, type NativeRunInput } from "../../src/harness/lifecycle.js";
import type { NativeRunServices } from "../../src/harness/run-services.js";
import { createLocalSandboxAdapter } from "@tabdo/agent-runtime/sandbox/local";
import { restoreWorkspace, snapshotWorkspace } from "../../src/harness/workspace.js";

// Exercise the official HarnessAgent against its public adapter contract. This
// fixture deliberately has no Pi filename or native journal representation.
function fixture(options: { failure?: "stop" | "detach" | "restore"; cancelled?: boolean; harness?: "pi" | "codex" | "claude" } = {}) {
  const harnessId = options.harness === "claude" ? "claude-code" : options.harness ?? "pi";
  const id = () => randomUUID(), now = new Date(), threadId = id(), recordId = id(), userMessageId = id(), assistantMessageId = id();
  const previous: HarnessAgentResumeSessionState = { specificationVersion: "harness-v1", harnessId, type: "resume-session", data: { ticket: ["opaque", { version: 7 }] } };
  const next: HarnessAgentResumeSessionState = { ...previous, data: { ticket: ["next", { version: 8 }] } };
  const workspace = [{ type: "file" as const, path: "/workspace/result.bin", mode: 0o644, content: btoa("completed result") }];
  const input: NativeRunInput = {
    actor: { kind: "human", userId: id(), organizationId: id(), memberId: id(), role: "owner", name: "Opaque fixture", email: "opaque@local.test" },
    lease: { threadId, token: id(), fence: 1 },
    record: { id: recordId, threadId, agentProfileId: id(), harness: options.harness ?? "pi", mode: "local", provider: "local", sandboxCreated: true,
      sessionId: id(), sandboxId: id(), resumeState: previous, workspace, lastUserMessageId: id(), lastAssistantMessageId: id(), status: "ready", error: null, updatedAt: now },
    run: { id: id(), threadId, runtimeSessionId: recordId, userMessageId, assistantMessageId, fence: 1, status: "starting", activity: null,
      cancelRequestedAt: options.cancelled ? now : null, error: null, startedAt: now, endedAt: null },
    harness: options.harness ?? "pi", instructions: "Opaque fixture", tools: {}, skills: [], prompt: "New input", messages: [{ id: userMessageId, role: "user", parts: [{ type: "text", text: "New input" }] }], metadata: {},
  };
  const calls = { starts: 0, prompts: 0, stops: 0, detaches: 0, uninvoked: 0, released: 0, failures: [] as string[], snapshots: [] as NativeRunInput["record"]["workspace"][], checkpoints: [] as Parameters<NativeRunServices["completeRuntimeTurn"]>[3][] };
  const harness: HarnessV1 = {
    specificationVersion: "harness-v1", harnessId, builtinTools: {},
    async doStart(start) {
      calls.starts++;
      assert.equal(start.sessionId, input.record.sessionId);
      assert.deepEqual(start.resumeFrom, input.record.resumeState ?? undefined);
      if (options.failure === "restore") throw new Error("Fixture SDK restore failed");
      const session: HarnessV1Session = {
        sessionId: start.sessionId, isResume: true,
        async doPromptTurn(turn) {
          calls.prompts++;
          turn.emit({ type: "stream-start" });
          if (options.failure === "detach") turn.emit({ type: "tool-call", toolCallId: "question", toolName: "client_question", input: "{}" });
          else {
            turn.emit({ type: "text-start", id: "reply" });
            turn.emit({ type: "text-delta", id: "reply", delta: "Actual fixture reply" });
            turn.emit({ type: "text-end", id: "reply" });
          }
          turn.emit({ type: "finish", finishReason: { unified: options.failure === "detach" ? "tool-calls" : "stop", raw: undefined }, totalUsage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } });
          return { done: Promise.resolve(), async submitToolResult() {} };
        },
        async doContinueTurn() { throw new Error("No unfinished input to replay"); },
        async doCompact() {},
        async doSuspendTurn() { return { ...previous, type: "continue-turn" }; },
        async doStop() { calls.stops++;if (options.failure === "stop") throw new Error("Fixture SDK stop failed");return next; },
        async doDetach() { calls.detaches++;throw new Error("Fixture SDK detach failed"); },
        async doDestroy() {},
      };
      return session;
    },
  };
  const services: NativeRunServices = {
    createNativeAgent: () => {
      const agent = new HarnessAgent<HarnessV1, ToolSet>({ harness, tools: { client_question: tool({ inputSchema: z.object({}) }) } });
      if (options.failure === "detach") {
        const createSession = agent.createSession.bind(agent);
        agent.createSession = async request => {
          const session = await createSession(request);
          // Inject failure at the public method; SDK host-input suspension still
          // determines hasUnfinishedTurn without inspecting adapter state.
          session.detach = async () => { calls.detaches++;throw new Error("Fixture SDK detach failed"); };
          return session;
        };
      }
      return agent;
    },
    async openNativeSandbox(request) {
      const adapter = createLocalSandboxAdapter({ cwd: "/workspace", env: {}, createFilesystem: () => restoreWorkspace(request.workspace), restoreFilesystem: () => restoreWorkspace(request.workspace) });
      const opened = request.hasResumeState ? await adapter.resume({ sandboxId: request.sandboxId }) : await adapter.create({ sandboxId: request.sandboxId });
      return { sandbox: opened.session, fs: opened.workspace };
    },
    hostTools: definitions => ({ tools: definitions, failures: new Map(), projectErrors: () => new TransformStream() }),
    nativeToolDenial: () => undefined, chatErrorText: error => error instanceof Error ? error.message : String(error), normalizeChatToolErrors: () => new TransformStream(),
    isOwnershipConflict: () => false, registerNativeRun: () => () => {}, logger: { warn() {}, error() {} }, limits: { timeout: { totalMs: 5000 } },
    questionContinuation: () => undefined, parkQuestionSandbox() { assert.fail("No question parking on checkpoint failure"); }, takeQuestionSandbox: () => undefined,
    async snapshotWorkspace(fs) { const snapshot = await snapshotWorkspace(fs);calls.snapshots.push(snapshot);return snapshot; }, async bindRuntimeSandbox(_lease, _record, sandboxId) { assert.equal(sandboxId, input.record.sandboxId); },
    async discardUninvokedSandbox() { assert.fail("Never replace or destroy a restored resource"); }, async renewRuntimeLease() { return true; },
    async releaseRuntimeLease() { calls.released++; }, async runCancellationRequested() { return options.cancelled ?? false; }, async recordRunActivity() { return true; },
    async failNativeRun(_lease, _run, error) { calls.failures.push(error); },
    async completeRuntimeTurn(_lease, _actor, _record, checkpoint) { calls.checkpoints.push(checkpoint); },
    async completeUninvokedRun() { calls.uninvoked++; }, async saveMessage() {},
  };
  return { input, services, calls, previous, next, workspace };
}

test("opaque checkpoint passes through the SDK and persistence without a recognized Pi filename or extension", async () => {
  const f = fixture(), original = structuredClone(f.input.record);
  await executeNativeRun(f.services, f.input);
  assert.equal(f.calls.starts, 1);assert.equal(f.calls.prompts, 1);assert.equal(f.calls.stops, 1);assert.equal(f.calls.released, 1);
  assert.equal(f.calls.uninvoked, 0);assert.deepEqual(f.calls.failures, []);assert.equal(f.calls.checkpoints.length, 1);
  assert.deepEqual(f.calls.checkpoints[0].resumeState, f.next);assert.equal(f.calls.checkpoints[0].workspace, f.calls.snapshots[0]);
  assert.deepEqual(f.calls.checkpoints[0].workspace?.find(entry => entry.path === "/workspace/result.bin"), f.workspace[0]);
  assert.equal(f.calls.checkpoints[0].sandboxId, f.input.record.sandboxId);assert.deepEqual(f.input.record, original);
});

test("SDK restoration failure is exposed without replacement creation, invocation, or a fabricated checkpoint", async () => {
  const f = fixture({ failure: "restore" }), chunks: unknown[] = [];
  await executeNativeRun(f.services, f.input, { write: chunk => { chunks.push(chunk); } });
  assert.match(JSON.stringify(chunks), /Fixture SDK restore failed/);
  assert.equal(f.calls.starts, 1);assert.equal(f.calls.prompts, 0);assert.equal(f.calls.uninvoked, 0);
  assert.deepEqual(f.calls.checkpoints, []);assert.deepEqual(f.calls.failures, ["Fixture SDK restore failed"]);assert.equal(f.calls.released, 1);
});

for (const failure of ["stop", "detach"] as const) test(`SDK ${failure} failure after invocation never falls back to the old checkpoint or an uninvoked proof`, async () => {
  const f = fixture({ failure });
  await assert.rejects(executeNativeRun(f.services, f.input), new RegExp(`Fixture SDK ${failure} failed`));
  assert.equal(f.calls.prompts, 1);assert.equal(failure === "stop" ? f.calls.stops : f.calls.detaches, 1);
  assert.deepEqual(f.calls.checkpoints, []);assert.equal(f.calls.uninvoked, 0);
  assert(f.calls.failures.length > 0);assert(f.calls.failures.every(error => error === `Fixture SDK ${failure} failed`));assert.equal(f.calls.released, 1);
});

test("pre-invocation cancellation preserves the last opaque checkpoint even when cleanup stop fails", async () => {
  const f = fixture({ cancelled: true, failure: "stop" }), original = structuredClone(f.input.record), chunks: unknown[] = [];
  await executeNativeRun(f.services, f.input, { write: chunk => { chunks.push(chunk); } });
  assert.equal(f.calls.starts, 1);assert.equal(f.calls.prompts, 0);assert.equal(f.calls.stops, 1);assert.equal(f.calls.uninvoked, 1);
  assert.deepEqual(f.calls.checkpoints, []);assert.deepEqual(f.calls.failures, []);assert.deepEqual(f.input.record, original);
  assert(chunks.some(chunk => (chunk as { type: string }).type === "abort"));assert.equal(f.calls.released, 1);
});

for (const harness of ["pi", "codex", "claude"] as const) {
  for (const hasCheckpoint of [false, true]) test(`${harness}: pre-invocation cancellation preserves ${hasCheckpoint ? "the opaque checkpoint" : "an uninvoked first turn"}`, async () => {
    const f = fixture({ harness, cancelled: true });
    if (!hasCheckpoint) { f.input.record.resumeState = null;f.input.record.workspace = null; }
    const original = structuredClone(f.input.record);
    await executeNativeRun(f.services, f.input);
    assert.equal(f.calls.starts, 1);assert.equal(f.calls.prompts, 0);assert.equal(f.calls.uninvoked, 1);
    assert.deepEqual(f.calls.checkpoints, []);assert.deepEqual(f.calls.failures, []);assert.deepEqual(f.input.record, original);assert.equal(f.calls.released, 1);
  });
}

for (const mode of ["local", "sandbox"] as const) test(`${mode}: public restore lookup failure cannot certify an uninvoked retry`, async () => {
  const f = fixture(), chunks: unknown[] = [], original = structuredClone(f.input.record);
  f.input.record.mode = mode;f.input.record.provider = mode === "local" ? "local" : "vercel";
  f.services.openNativeSandbox = async () => { throw new Error("Fixture public sandbox restore failed"); };
  await executeNativeRun(f.services, f.input, { write: chunk => { chunks.push(chunk); } });
  assert.equal(f.calls.starts, 0);assert.equal(f.calls.prompts, 0);assert.equal(f.calls.uninvoked, 0);
  assert.deepEqual(f.calls.checkpoints, []);assert.deepEqual(f.calls.failures, ["Fixture public sandbox restore failed"]);
  assert.deepEqual(f.input.record.resumeState, original.resumeState);assert.deepEqual(f.input.record.workspace, original.workspace);
  assert.match(JSON.stringify(chunks), /Fixture public sandbox restore failed/);assert.equal(f.calls.released, 1);
});

for (const harness of ["pi", "codex", "claude"] as const) test(`${harness}: construction failure before invocation preserves the existing checkpoint`, async () => {
  const f = fixture({ harness }), original = structuredClone(f.input.record);
  f.services.createNativeAgent = () => { throw new Error("Fixture public configuration rejected"); };
  await executeNativeRun(f.services, f.input);
  assert.equal(f.calls.starts, 0);assert.equal(f.calls.prompts, 0);assert.equal(f.calls.uninvoked, 1);
  assert.deepEqual(f.calls.checkpoints, []);assert.deepEqual(f.calls.failures, []);assert.deepEqual(f.input.record, original);assert.equal(f.calls.released, 1);
});
