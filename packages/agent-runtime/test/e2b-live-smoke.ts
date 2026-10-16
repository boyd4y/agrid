import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, stat, rm } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Sandbox, CommandExitError, SandboxNotFoundError } from "e2b";
import { HARNESS_V1_BUILTIN_TOOLS } from "@ai-sdk/harness";
import { HarnessAgent, type HarnessAgentSession } from "@ai-sdk/harness/agent";
import { createPi } from "@ai-sdk/harness-pi";
import { createCodex } from "@ai-sdk/harness-codex";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import { createE2BSandboxAdapter } from "../src/sandbox/e2b.js";

// Explicit opt-in only; this file is intentionally outside *.test.ts.
const envIndex = process.argv.indexOf("--env-file");
if (envIndex !== -1) {
  const path = process.argv[envIndex + 1];
  assert(path && ((await stat(path)).mode & 0o777) === 0o600, "credential file must have mode 0600");
  process.env.E2B_API_KEY = parseEnv(await readFile(path, "utf8")).E2B_API_KEY;
}
if (!process.env.E2B_API_KEY || process.env.HARNESS_E2B_SMOKE !== "1") {
  console.error("BLOCKED: E2B_API_KEY and HARNESS_E2B_SMOKE=1 are required; no resources created.");
  process.exit(2);
}
const apiKey = process.env.E2B_API_KEY;
const runId = `tabdo-0016-${randomUUID()}`;
const metadata = { verification: runId };
const known = new Set<string>();
const tokens = new Set<string>([apiKey]);
const clean = (error: unknown) => {
  let message = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
  for (const token of tokens) message = message.replaceAll(token, "[redacted]");
  return message.slice(0, 1800);
};
const log = (name: string, status: string, details = "") => console.log(JSON.stringify({ at: new Date().toISOString(), runId, name, status, details }));
const track = (sandbox: Sandbox) => {
  known.add(sandbox.sandboxId); if (sandbox.trafficAccessToken) tokens.add(sandbox.trafficAccessToken);
  log("resource", "CREATED", sandbox.sandboxId); return sandbox;
};
const makeAdapter = (tag: string) => createE2BSandboxAdapter({ apiKey, timeoutMs: 10 * 60_000,
  template: process.env.E2B_TEMPLATE, ports: [4000, 4010], metadata: { ...metadata, case: tag } });
async function list(tag?: string) {
  const paginator = Sandbox.list({ apiKey, query: { metadata: { ...metadata, ...(tag ? { case: tag } : {}) }, state: ["running", "paused"] } });
  const all = []; while (paginator.hasNext) all.push(...await paginator.nextItems()); return all;
}
async function kill(id: string) {
  await Sandbox.kill(id, { apiKey }); log("cleanup", "DESTROYED", id);
}
async function check(name: string, work: () => Promise<void>) {
  try { await work(); log(name, "PASS"); }
  catch (error) { log(name, "FAIL", clean(error)); process.exitCode = 1; }
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const text = async (stream: ReadableStream<Uint8Array> | null) => stream ? new Response(stream).text() : null;
async function within<T>(pending: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([pending, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
  finally { clearTimeout(timer); }
}

async function sdkProbe() {
  const native = track(await Sandbox.create({ apiKey, timeoutMs: 120_000, metadata: { ...metadata, case: "sdk" }, network: { allowPublicTraffic: false } }));
  try {
    assert(native.sandboxId); assert((await native.commands.run("pwd")).stdout.startsWith("/"));
    await native.files.write("sdk-proof.bin", new Uint8Array([0, 255, 13, 10]).buffer);
    assert.deepEqual([...await native.files.read("sdk-proof.bin", { format: "bytes" })], [0, 255, 13, 10]);
    await assert.rejects(native.commands.run("printf sdk-out; printf sdk-err >&2; exit 7"), error => error instanceof CommandExitError
      && error.exitCode === 7 && error.stdout === "sdk-out" && error.stderr === "sdk-err");
    await native.pause(); assert.equal((await Sandbox.getInfo(native.sandboxId, { apiKey })).state, "paused");
    const resumed = await Sandbox.connect(native.sandboxId, { apiKey, timeoutMs: 90_000 });
    assert.equal(resumed.sandboxId, native.sandboxId);
    assert.deepEqual([...await resumed.files.read("sdk-proof.bin", { format: "bytes" })], [0, 255, 13, 10]);
    log("sdk-domain", "PASS", resumed.getHost(4010));
  } finally { await kill(native.sandboxId); }
  const expires = track(await Sandbox.create({ apiKey, timeoutMs: 5_000, metadata: { ...metadata, case: "sdk-timeout" } }));
  try {
    assert.equal((await Sandbox.getInfo(expires.sandboxId, { apiKey })).state, "running");
    await sleep(7_000);
    await assert.rejects(Sandbox.getInfo(expires.sandboxId, { apiKey }), error => error instanceof SandboxNotFoundError);
    await assert.rejects(Sandbox.connect(expires.sandboxId, { apiKey }), error => error instanceof SandboxNotFoundError);
    log("sdk-default-timeout-kills", "PASS", expires.sandboxId);
  } finally { await kill(expires.sandboxId); }
}

async function adapterProbe() {
  const adapter = makeAdapter("adapter"); let prepares = 0;
  const { session } = await adapter.create({ template: { identity: runId, prepare: async ({ session }) => {
    assert(!("destroy" in session)); prepares++;
    await session.writeTextFile({ path: "template-marker", content: "prepared-once" });
  } } });
  known.add(session.id); log("resource", "CREATED", session.id);
  try {
    assert.equal(session.defaultWorkingDirectory, (await session.run({ command: "pwd" })).stdout.trim());
    const bytes = Buffer.from([1, 0, 255, 128, 2]).subarray(1, 4);
    await session.writeBinaryFile({ path: "binary", content: bytes });
    assert.deepEqual([...await session.readBinaryFile({ path: "binary" }) ?? []], [0, 255, 128]);
    const content = new Uint8Array([0, 1, 255]);
    await session.writeFile({ path: "stream", content: new ReadableStream({ start(c) { c.enqueue(content); c.close(); } }) });
    assert.deepEqual([...new Uint8Array(await new Response(await session.readFile({ path: "stream" })).arrayBuffer())], [...content]);
    assert.equal(await session.readFile({ path: "absent-file" }), null);
    assert.equal(await session.readBinaryFile({ path: "absent-file" }), null);
    assert.equal(await session.readTextFile({ path: "absent-file" }), null);
    await session.writeTextFile({ path: "lines", content: "one\n二\nthree\nfour\n" });
    assert.equal(await session.readTextFile({ path: "lines", startLine: 2, endLine: 3 }), "二\nthree");
    assert.deepEqual(await session.run({ command: "printf out; printf err >&2; exit 9" }), { stdout: "out", stderr: "err", exitCode: 9 });
    assert.deepEqual(await session.run({ command: "printf '%s' \"$E2B_TEST_VALUE\"", env: { E2B_TEST_VALUE: "value" }, workingDirectory: session.defaultWorkingDirectory }), { stdout: "value", stderr: "", exitCode: 0 });
    const process = await session.spawn({ command: "printf spawn-out; printf spawn-err >&2; exit 6" });
    const output = text(process.stdout), errors = text(process.stderr);
    assert.equal((await process.wait()).exitCode, 6); assert.equal(await output, "spawn-out"); assert.equal(await errors, "spawn-err");
    const killed = await session.spawn({ command: "sleep 60" }); await killed.kill(); assert.notEqual((await killed.wait()).exitCode, 0);
    for (const spawn of [false, true]) {
      const controller = new AbortController();
      const command = `echo $$ > ${spawn ? "spawn" : "run"}.pid; exec sleep 60`;
      let wait: Promise<unknown>;
      if (spawn) { const child = await session.spawn({ command, abortSignal: controller.signal }); wait = Promise.resolve(child.wait()); }
      else wait = Promise.resolve(session.run({ command, abortSignal: controller.signal }));
      const rejected = assert.rejects(wait, error => error === controller.signal.reason);
      for (let i = 0; i < 50 && await session.readTextFile({ path: `${spawn ? "spawn" : "run"}.pid` }) === null; i++) await sleep(100);
      controller.abort(new Error("task cancellation")); await rejected;
      const pid = (await session.readTextFile({ path: `${spawn ? "spawn" : "run"}.pid` }))?.trim(); assert(pid);
      assert.notEqual((await session.run({ command: `kill -0 ${pid} 2>/dev/null` })).exitCode, 0, "cancelled remote process must exit");
    }
    const server = await session.spawn({ command: "python3 -m http.server 4010 --bind 0.0.0.0" });
    try {
      const endpoint = await session.getPortEndpoint({ port: 4010 });
      for (const value of Object.values(endpoint.headers ?? {})) tokens.add(value);
      assert.equal(new URL(endpoint.url).protocol, "https:"); assert(endpoint.headers?.["e2b-traffic-access-token"]);
      assert.equal(await session.getPortUrl({ port: 4010 }), endpoint.url);
      assert((await session.getPortEndpoint({ port: 4010, protocol: "ws" })).url.startsWith("wss:"));
      let response: Response | undefined;
      for (let i = 0; i < 30; i++) { response = await fetch(`${endpoint.url}/template-marker`, { headers: endpoint.headers }); if (response.ok) break; await sleep(200); }
      assert.equal(await response?.text(), "prepared-once");
      assert.equal((await fetch(endpoint.url)).status, 403, "private ingress rejects a missing token");
      log("adapter-domain-headers", "PASS", new URL(endpoint.url).hostname);
    } finally { await server.kill(); await server.wait(); }
    await session.stop(); await session.stop();
    assert.equal((await Sandbox.getInfo(session.id, { apiKey })).state, "paused");
    const { session: resumed } = await adapter.resume({ sandboxId: session.id });
    assert.equal(resumed.id, session.id); assert.equal(prepares, 1);
    assert.equal(await resumed.readTextFile({ path: "template-marker" }), "prepared-once");
    assert.deepEqual([...await resumed.readBinaryFile({ path: "binary" }) ?? []], [0, 255, 128]);
    await resumed.stop(); await resumed.destroy(); await resumed.destroy();
    await assert.rejects(adapter.resume({ sandboxId: session.id }));
    assert.equal((await list("adapter")).length, 0, "destroyed resume must never create a replacement");
  } finally { await session.destroy(); log("cleanup", "DESTROYED", session.id); }
}

async function acquisitionFailures() {
  for (const cancelled of [false, true]) {
    const tag = cancelled ? "cancelled-create" : "failed-prepare", adapter = makeAdapter(tag), controller = new AbortController();
    const failure = new Error(tag);
    await assert.rejects(adapter.create({ abortSignal: controller.signal, template: { identity: tag, prepare: async () => {
      const resources = await list(tag); assert.equal(resources.length, 1);
      for (const resource of resources) { known.add(resource.sandboxId); log("resource", "CREATED", resource.sandboxId); }
      if (cancelled) controller.abort(failure); else throw failure;
    } } }), error => error === failure);
    assert.equal((await list(tag)).length, 0, "failed or cancelled preparation must leave no resource");
  }
  await assert.rejects(createE2BSandboxAdapter({ apiKey, template: `missing-${runId}`, metadata }).create());
  await assert.rejects(makeAdapter("missing").resume({ sandboxId: `missing-${runId}` }));
  const adapter = makeAdapter("cancelled-resume"), { session } = await adapter.create();
  known.add(session.id); log("resource", "CREATED", session.id);
  try {
    await session.writeTextFile({ path: "retained", content: "original" }); await session.stop();
    const abortSignal = AbortSignal.timeout(1);
    await assert.rejects(adapter.resume({ sandboxId: session.id, abortSignal }), error => error === abortSignal.reason);
    assert.equal((await Sandbox.getInfo(session.id, { apiKey })).state, "paused");
    const resumed = (await adapter.resume({ sandboxId: session.id })).session;
    assert.equal(resumed.id, session.id); assert.equal(await resumed.readTextFile({ path: "retained" }), "original");
  } finally { await session.destroy(); log("cleanup", "DESTROYED", session.id); }
}

type ProviderRequest = { messages: unknown[]; tools?: { function: { name: string } }[] };
async function piProbe() {
  const adapter = makeAdapter("pi"), sessionId = `${runId}-pi`;
  let sandbox = (await adapter.create()).session; known.add(sandbox.id); log("resource", "CREATED", sandbox.id);
  let session: HarnessAgentSession | undefined;
  let phase = "write", count = 0, workDir = "";
  const calls: ProviderRequest[] = [], failures: unknown[] = [];
  const provider = createServer(async (request, response) => {
    try {
      let raw = ""; for await (const part of request) raw += part;
      const body = JSON.parse(raw) as ProviderRequest; calls.push(body); count++;
      const history = JSON.stringify(body.messages);
      let name: string | undefined, input: Record<string, unknown> = {}, reply = "";
      if (phase === "write" && count === 1) { name = "write"; input = { file_path: `${workDir}/native-file`, content: "pi-native-marker" }; }
      else if (phase === "write" && count === 2) { name = "read"; input = { file_path: `${workDir}/native-file` }; }
      else if (phase === "write" && count === 3) { assert(history.includes("pi-native-marker")); name = "bash"; input = { command: `printf 'committed\\n' >> '${workDir}/count'; printf 'e2b-remote-tool-result'`, timeout: 30 }; }
      else if (phase === "write") { assert(history.includes("e2b-remote-tool-result")); reply = "Remote write completed."; }
      else if (phase === "recall") { assert(history.includes("Remote write completed.") && history.includes("e2b-remote-tool-result")); reply = "History restored."; }
      else if (phase === "question") { name = "askUserQuestions"; input = { allowPartialAnswers: false, questions: [{ id: "direction", question: "Choose", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], allowFreeForm: true }] }; }
      else if (phase === "answer") { assert(history.includes('"b"') || history.includes('\\"b\\"')); reply = "Answer B received."; }
      else if (phase === "cancel") { name = "bash"; input = { command: `echo $$ > '${workDir}/cancel.pid'; exec sleep 60`, timeout: 90 }; }
      else throw new Error("unexpected provider phase");
      if (name) assert(body.tools?.some(entry => entry.function.name === name));
      response.writeHead(200, { "content-type": "text/event-stream" });
      const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: `e2b-${count}`, object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      send({ role: "assistant" });
      if (name) { send({ tool_calls: [{ index: 0, id: `tool-${count}`, type: "function", function: { name, arguments: JSON.stringify(input) } }] }); send({}, "tool_calls"); }
      else { send({ content: reply }); send({}, "stop"); }
      response.end("data: [DONE]\n\n");
    } catch (error) { failures.push(error); response.writeHead(400); response.end(JSON.stringify({ error: { message: "fixture assertion failed" } })); }
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address(); assert(address && typeof address !== "string");
  const makeAgent = () => new HarnessAgent({ harness: createPi({ auth: {}, reattachInProcess: false, providers: { fixture: {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "local-fixture", authHeader: true, api: "openai-completions",
    models: [{ id: "fixture", name: "fixture", contextWindow: 65536, maxTokens: 1024, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  } } }), model: "fixture/fixture", instructions: "Use the requested tools.", sandboxConfig: { workDir: "fixture" }, stopWhen: [], tools: { askUserQuestions: HARNESS_V1_BUILTIN_TOOLS.askUserQuestions } });
  try {
    let agent = makeAgent();
    session = await agent.createSession({ sessionId, sandboxSession: sandbox, abortSignal: AbortSignal.timeout(60_000) });
    workDir = `${sandbox.defaultWorkingDirectory}/fixture`;
    assert.equal((await agent.generate({ session, prompt: "Write once remotely.", abortSignal: AbortSignal.timeout(60_000) })).text, "Remote write completed.");
    assert.equal(await sandbox.readTextFile({ path: `${workDir}/native-file` }), "pi-native-marker");
    assert.equal(await sandbox.readTextFile({ path: `${workDir}/count` }), "committed\n");
    const saved = JSON.parse(JSON.stringify(await session.stop())); session = undefined;
    await sandbox.stop(); sandbox = (await adapter.resume({ sandboxId: sandbox.id })).session;
    agent = makeAgent(); session = await agent.createSession({ sessionId, sandboxSession: sandbox, resumeFrom: saved, abortSignal: AbortSignal.timeout(60_000) });
    phase = "recall";
    assert.equal((await agent.generate({ session, prompt: "Recall without writing again.", abortSignal: AbortSignal.timeout(60_000) })).text, "History restored.");
    try { assert(JSON.stringify(await session.readHistory()).includes("Remote write completed.")); }
    catch (error) {
      if (error instanceof Error && error.name === "AI_HarnessCapabilityUnsupportedError") log("pi-readHistory", "UNSUPPORTED", clean(error));
      else throw error;
    }
    assert.equal(await sandbox.readTextFile({ path: `${workDir}/count` }), "committed\n");
    log("harness-pi-remote-tools-opaque-resume", "PASS", sandbox.id);
    phase = "question";
    const result = await agent.stream({ session, prompt: "Ask direction.", abortSignal: AbortSignal.timeout(60_000) }); for await (const _ of result.stream) { /* official stream */ }
    assert(session.hasUnfinishedTurn());
    const questionId = `tool-${count}`;
    const pending = JSON.parse(JSON.stringify(await session.detach())); session = undefined;
    await sandbox.stop(); sandbox = (await adapter.resume({ sandboxId: sandbox.id })).session;
    agent = makeAgent(); session = await agent.createSession({ sessionId, sandboxSession: sandbox, resumeFrom: pending, abortSignal: AbortSignal.timeout(60_000) });
    phase = "answer";
    assert.equal((await agent.continueGenerate({ session, abortSignal: AbortSignal.timeout(60_000), toolResultContinuations: [{ type: "tool-result", toolCallId: questionId, toolName: "askUserQuestions",
      output: { type: "json", value: { action: "answered", answers: { direction: { optionIds: ["b"] } } } } }] })).text, "Answer B received.");
    assert.equal(await sandbox.readTextFile({ path: `${workDir}/count` }), "committed\n");
    log("harness-pi-question-continuation", "PASS");
    phase = "cancel";
    const controller = new AbortController();
    const running = await agent.stream({ session, prompt: "Start cancellable command.", abortSignal: controller.signal });
    const drain = (async () => { for await (const _ of running.stream) { /* drain cancellation */ } })();
    let pid: string | null = null;
    for (let i = 0; i < 100 && !pid; i++) { pid = await sandbox.readTextFile({ path: `${workDir}/cancel.pid` }); if (!pid) await sleep(100); }
    assert(pid, "actual remote bash must start before cancellation");
    const cancelledAt = Date.now(); controller.abort();
    await within(drain, 10_000, "native Pi cancellation did not settle within 10 seconds");
    let exited = false, status = "";
    const cleanupDeadline = Date.now() + 5_000;
    while (Date.now() < cleanupDeadline) {
      status = (await sandbox.run({ command: `ps -o stat=,comm= -p ${pid.trim()} || true` })).stdout.trim();
      if (!status || status.startsWith("Z")) { exited = true; break; }
      await sleep(100);
    }
    if (!exited) log("harness-pi-cancel-process", "FAIL", `${pid.trim()}: ${status}`);
    assert(exited, "cancelled native command must exit within the bounded cleanup interval");
    assert.equal(failures.length, 0, failures.map(clean).join("\n"));
    log("harness-pi-cancel", "PASS", `${Date.now() - cancelledAt}ms`);
    await session.stop(); session = undefined;
  } finally {
    try { await session?.destroy(); }
    finally {
      try { await sandbox.destroy(); log("cleanup", "DESTROYED", sandbox.id); }
      finally {
        provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve()));
        await rm(join(tmpdir(), "ai-sdk-harness", "pi", sessionId), { recursive: true, force: true });
      }
    }
  }
}

async function bridgeProbe(kind: "codex" | "claude-code") {
  const sandbox = (await makeAdapter(kind).create()).session; known.add(sandbox.id); log("resource", "CREATED", sandbox.id);
  let session: HarnessAgentSession | undefined;
  try {
    const info = await Sandbox.getInfo(sandbox.id, { apiKey });
    log(`${kind}-resource-spec`, "INFO", JSON.stringify({ templateId: info.templateId, cpuCount: info.cpuCount, memoryMB: info.memoryMB }));
    const capability = await sandbox.run({ command: "node --version; pnpm --version" });
    log(`${kind}-prerequisites`, "INFO", capability.stdout.trim());
    if (process.argv.includes("--provision-bridge")) {
      const provision = await sandbox.run({ command: "sudo npm install -g pnpm@10.32.1" });
      assert.equal(provision.exitCode, 0, provision.stderr);
      log(`${kind}-test-only-provision`, "PASS", "pnpm@10.32.1 installed only in disposable sandbox");
    }
    await sandbox.writeTextFile({ path: "e2b-model.mjs", content: await readFile(new URL("./fixture/e2b-model.mjs", import.meta.url), "utf8") });
    const model = await sandbox.spawn({ command: "node e2b-model.mjs" });
    let ready = false;
    for (let i = 0; i < 30; i++) {
      if ((await sandbox.run({ command: "curl --fail --silent http://127.0.0.1:4010/health" })).exitCode === 0) { ready = true; break; }
      await sleep(100);
    }
    assert(ready, "in-sandbox HTTP model fixture must be ready");
    const harness = kind === "codex" ? createCodex({ auth: { OPENAI_API_KEY: "local-fixture", OPENAI_BASE_URL: "http://127.0.0.1:4010/v1" } })
      : createClaudeCode({ auth: { ANTHROPIC_API_KEY: "local-fixture", ANTHROPIC_BASE_URL: "http://127.0.0.1:4010" } });
    const makeAgent = () => new HarnessAgent({ harness, model: kind === "codex" ? "gpt-5" : "claude-sonnet-4-5", permissionMode: "allow-all", sandboxConfig: { workDir: "bridge-work" }, tools: {} });
    const agent = makeAgent();
    // Attempt the actual official bootstrap before classifying missing dependencies.
    session = await agent.createSession({ sessionId: `${runId}-${kind}`, sandboxSession: sandbox, abortSignal: AbortSignal.timeout(240_000) });
    log(`${kind}-bootstrap`, "PASS");
    const result = await agent.generate({ session, prompt: "Run the remote shell fixture once.", abortSignal: AbortSignal.timeout(60_000) });
    assert.equal(result.text, "E2B bridge complete.");
    const countPath = `${sandbox.defaultWorkingDirectory}/bridge-work/bridge-count`;
    assert.equal(await sandbox.readTextFile({ path: countPath }), "committed\n");
    const requests = await sandbox.readTextFile({ path: "bridge-requests.json" });
    assert(requests?.includes("bridge-remote-tool-result"), "real shell result reaches remote model fixture");
    const resumeFrom = JSON.parse(JSON.stringify(await session.stop())); session = undefined;
    await sandbox.stop();
    assert.equal((await Sandbox.getInfo(sandbox.id, { apiKey })).state, "paused");
    const resumed = (await makeAdapter(kind).resume({ sandboxId: sandbox.id })).session;
    assert.equal(resumed.id, sandbox.id);
    assert.equal(await resumed.readTextFile({ path: countPath }), "committed\n");
    const next = makeAgent();
    session = await next.createSession({ sessionId: `${runId}-${kind}`, sandboxSession: resumed, resumeFrom, abortSignal: AbortSignal.timeout(60_000) });
    assert.equal((await next.generate({ session, prompt: "Recall the completed write without repeating it.", abortSignal: AbortSignal.timeout(60_000) })).text, "E2B bridge complete.");
    assert.equal(await resumed.readTextFile({ path: countPath }), "committed\n");
    const historyRequests = JSON.parse(await resumed.readTextFile({ path: "bridge-requests.json" }) ?? "[]") as { body: unknown }[];
    const latest = JSON.stringify(historyRequests.at(-1)?.body);
    assert(latest.includes("bridge-remote-tool-result") && latest.includes("E2B bridge complete."), "resumed native model request must carry actual prior tool result and reply");
    log(`${kind}-model-fixture-opaque-resume`, "PASS", sandbox.id);
    await resumed.writeTextFile({ path: "bridge-phase", content: "cancel" });
    const controller = new AbortController();
    const running = await next.stream({ session, prompt: "Start the cancellable remote command.", abortSignal: controller.signal });
    const drain = (async () => { for await (const _ of running.stream) { /* actual bridge turn */ } })();
    const pidPath = `${sandbox.defaultWorkingDirectory}/bridge-work/bridge-cancel.pid`;
    let pid: string | null = null;
    for (let i = 0; i < 100 && !pid; i++) { pid = await resumed.readTextFile({ path: pidPath }); if (!pid) await sleep(100); }
    assert(pid, "bridge shell must actually start before cancellation");
    const cancelledAt = Date.now(); controller.abort();
    await within(drain, 10_000, `${kind} cancellation did not settle within 10 seconds`);
    let status = "";
    const deadline = Date.now() + 5_000;
    do {
      status = (await resumed.run({ command: `ps -o stat=,comm= -p ${pid.trim()} || true` })).stdout.trim();
      if (!status || status.startsWith("Z")) break;
      await sleep(100);
    } while (Date.now() < deadline);
    assert(!status || status.startsWith("Z"), `cancelled bridge command still running: ${status}`);
    assert.equal(await resumed.readTextFile({ path: countPath }), "committed\n");
    log(`${kind}-cancel`, "PASS", `${Date.now() - cancelledAt}ms`);
    await session.stop(); session = undefined;
    await model.kill(); await model.wait();
  } catch (error) {
    try {
      const metrics = await Sandbox.getMetrics(sandbox.id, { apiKey });
      log(`${kind}-memory-diagnostic`, "INFO", JSON.stringify({ samples: metrics.length,
        memTotal: metrics[0]?.memTotal, maxMemUsed: Math.max(0, ...metrics.map(sample => sample.memUsed)) }));
      const kernel = await sandbox.run({ command: "sudo dmesg | grep -E 'Out of memory|Killed process|oom-kill' | tail -5" });
      if (kernel.stdout) log(`${kind}-kernel-diagnostic`, "INFO", kernel.stdout.slice(-2000));
      const requests = await sandbox.readTextFile({ path: "bridge-requests.json" });
      if (requests) {
        const entries = JSON.parse(requests) as { path: string; body: { tools?: { name: string; type: string }[] } }[];
        log(`${kind}-fixture-diagnostic`, "INFO", JSON.stringify(entries.map(entry => ({ path: entry.path, tools: entry.body.tools?.map(tool => `${tool.type}:${tool.name}`) }))));
      }
    } catch { log(`${kind}-diagnostic`, "UNAVAILABLE"); }
    throw error;
  } finally {
    try { await session?.destroy(); }
    finally { await sandbox.destroy(); log("cleanup", "DESTROYED", sandbox.id); }
  }
}

try {
  log("versions", "INFO", "@ai-sdk/harness 1.0.152; @e2b/ai-sdk-sandbox 0.3.0; e2b 2.56.0");
  const only = process.argv.find(arg => arg.startsWith("--only="))?.slice(7);
  for (const [name, work] of [["sdk", sdkProbe], ["adapter", adapterProbe], ["acquisition", acquisitionFailures], ["pi", piProbe],
    ["codex", () => bridgeProbe("codex")], ["claude-code", () => bridgeProbe("claude-code")]] as const) {
    if (!only || only === name) await check(name, work);
  }
} finally {
  // Query only this run's unique metadata, including creates whose response failed.
  try {
    for (const resource of await list()) { known.add(resource.sandboxId); await kill(resource.sandboxId); }
    assert.equal((await list()).length, 0);
    log("all-task-resources-cleaned", "PASS", [...known].join(","));
  } catch (error) { log("cleanup", "FAIL", clean(error)); process.exitCode = 1; }
}
