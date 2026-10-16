import assert from "node:assert/strict";
import { createNativeModelFixture } from "./native-model-fixture.mjs";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarnessAgent } from "../src/harness/agent.js";
import type { NativeAgentSettings } from "../src/harness/types.js";
import { createCodexAdapter } from "../src/harness/codex.js";
import { createClaudeCodeAdapter } from "../src/harness/claude-code.js";
import { createLocalSandboxAdapter } from "../src/sandbox/local.js";
import { tool, jsonSchema, toUIMessageStream } from "ai";
import type { HarnessAgentResumeSessionState } from "@ai-sdk/harness/agent";

const selected = process.argv[process.argv.indexOf("--harness") + 1];
assert(selected === "codex" || selected === "claude", "Pass --harness codex|claude");
let writes = 0;
const fixture = createNativeModelFixture(selected);
const { model, bodies, errors, firstReply, secondReply } = fixture;
await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve));
const address = model.address();assert(address && typeof address !== "string");
const makeAdapter = () => selected === "codex" ? createCodexAdapter({ apiKey: "fixture-only", baseUrl: `http://127.0.0.1:${address.port}/v1`, model: "gpt-5.4" })
  : createClaudeCodeAdapter({ apiKey: "fixture-only", baseUrl: `http://127.0.0.1:${address.port}`, model: "claude-sonnet-4-6" });
const storage = await mkdtemp(join(tmpdir(), "tabdo-0013-native-"));
const sandboxAdapter = createLocalSandboxAdapter({ cwd: "/workspace", storageDirectory: storage, env: {
  ...(process.env.LOCAL_SANDBOX_NPM_REGISTRY ? { npm_config_registry: process.env.LOCAL_SANDBOX_NPM_REGISTRY } : {}),
  // Explicit test-only download configuration; never inherit the host environment.
  ...(process.env.LOCAL_NATIVE_SMOKE_HTTPS_PROXY ? { HTTPS_PROXY: process.env.LOCAL_NATIVE_SMOKE_HTTPS_PROXY } : {}),
} });
const sandboxConfig: NativeAgentSettings["sandboxConfig"] = { workDir: "agent", onSession: async ({ session, sessionWorkDir, abortSignal }) => {
  await session.writeTextFile({ path: `${sessionWorkDir}/AGENTS.md`, content: "Use the receipt tool once.", abortSignal });
} };
const makeAgent = () => createHarnessAgent(makeAdapter(), { instructions: "Call receipt once, then remember the result.",
  ...(process.argv.includes("--work-dir") ? { sandboxConfig } : {}),
  tools: { receipt: tool({ inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {}, additionalProperties: false }), execute: async () => {
    writes++;await opened.session.writeTextFile({ path: "receipt.txt", content: "committed once" });return { saved: true };
  } }) },
});
let agent = makeAgent();
let opened: Awaited<ReturnType<typeof sandboxAdapter.create>>;
let session: Awaited<ReturnType<typeof agent.createSession>> | undefined;
try {
  console.log(`[local-native] ${selected}: preparing official template`);
  const template = await agent.getSandboxTemplate();
  assert(template, "bridge harness must provide its official bootstrap template");
  opened = await sandboxAdapter.create({ template: { ...template, prepare: async ({ session, abortSignal }) => {
    const observed = ({ ...session, run: async (settings: Parameters<typeof session.run>[0]) => {
      const child = await session.spawn(settings);
      const collect = async (stream: ReadableStream<Uint8Array>) => {
        let text = "";const reader = stream.getReader(), decoder = new TextDecoder();
        try { for (;;) { const { done, value } = await reader.read();if (done) break;const chunk = decoder.decode(value, { stream: true });text += chunk;process.stdout.write(chunk); } }
        finally { reader.releaseLock(); }
        return text;
      };
      const [stdout, stderr, result] = await Promise.all([collect(child.stdout), collect(child.stderr), child.wait()]);
      return { stdout, stderr, ...result };
    } });
    await template.prepare({ session: observed, abortSignal });
  } }, abortSignal: AbortSignal.timeout(600_000) });
  console.log(`[local-native] ${selected}: creating official session`);
  const sessionId = randomUUID();
  session = await agent.createSession({ sandboxSession: opened.session, sessionId, abortSignal: AbortSignal.timeout(90_000) });
  let saved: HarnessAgentResumeSessionState | undefined;
  if (process.argv.includes("--stream")) {
    const result = await agent.stream({ session, prompt: "Save one receipt.", abortSignal: AbortSignal.timeout(60_000) });
    const projection = toUIMessageStream({ stream: result.stream, tools: agent.tools, onFinish: async ({ responseMessage }) => {
      assert.equal(responseMessage.parts.filter(part => part.type === "text").map(part => part.text).join(""), firstReply);
      saved = await session!.stop();
    } });
    const reader = projection.getReader();
    try { while (!(await reader.read()).done) { /* Drain the platform's public UI projection. */ } }
    finally { reader.releaseLock(); }
  } else {
    const first = await agent.generate({ session, prompt: "Save one receipt.", abortSignal: AbortSignal.timeout(60_000) });
    assert.equal(first.text, firstReply, JSON.stringify(first));saved = await session.stop();
  }
  assert(saved);assert.equal(writes, 1);assert.deepEqual(errors, []);
  const resumeFrom = JSON.parse(JSON.stringify(saved));session = undefined;fixture.nextTurn();
  await opened.session.stop();
  opened = await sandboxAdapter.resume({ sandboxId: opened.session.id });
  agent = makeAgent();
  // The official resume state stays opaque. Reattach a fresh agent/session to
  // the same provider resource, then ask for a fresh read-only turn.
  session = await agent.createSession({ sandboxSession: opened.session, sessionId, resumeFrom, abortSignal: AbortSignal.timeout(90_000) });
  assert.equal((await agent.generate({ session, prompt: "Remember the previous receipt without saving again.", abortSignal: AbortSignal.timeout(60_000) })).text, secondReply);
  assert.equal(writes, 1);assert.equal(await opened.session.readTextFile({ path: "receipt.txt" }), "committed once");
  assert(JSON.stringify(bodies.at(-1)).includes(firstReply), "official native history survives resume");
  const activeResponse = fixture.holdNextResponse();
  const cancellation = new AbortController();
  const pending = agent.generate({ session, prompt: "Wait for this response.", abortSignal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(30_000)]) });
  // Attach rejection handling before aborting a genuinely active HTTP turn.
  const cancelled = assert.rejects(pending, /cancel|abort/i);
  await Promise.race([activeResponse, new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error("Native cancellation request never reached model fixture")), 20_000);timer.unref();
  })]);
  cancellation.abort(new DOMException("fixture active cancellation", "AbortError"));
  await cancelled;
  assert.equal(writes, 1);
  await session.stop();session = undefined;
  await opened.session.destroy();
  await assert.rejects(stat(opened.workspace.root), { code: "ENOENT" });
  console.log(`[local-native] PASS ${selected}: real official template, bridge, model protocol fixture, host tool, file, opaque resume, history, no replay, active cancellation and cleanup; ${fixture.requests} model calls`);
} catch (error) {
  console.error(`[local-native] FAIL ${selected}`, error, errors);process.exitCode = 1;
} finally {
  await session?.destroy().catch(error => { console.error(error);process.exitCode = 1; });
  if (opened!) await opened.session.destroy();
  await rm(storage, { recursive: true, force: true });
  model.closeAllConnections();await new Promise<void>(resolve => model.close(() => resolve()));
}
