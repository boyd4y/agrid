import assert from "node:assert/strict";
import { createServer } from "node:http";
import { posix } from "node:path";
import type { NativeAgent } from "@tabdo/platform-node/harness/types";
import { createHarnessAgent } from "@tabdo/platform-node/harness/agent";
import { createPiAdapter } from "@tabdo/platform-node/harness/pi";
import { createLocalSandboxAdapter } from "@tabdo/platform-node/sandbox/local";
import { createDiskWorkspace } from "@tabdo/platform-node/sandbox/workspace";
import { tool } from "ai";
import { z } from "zod";

type Entry = { path: string; mode: number; type: "directory" | "file" | "symlink"; content?: string; target?: string };
type NativeSession = Awaited<ReturnType<NativeAgent["createSession"]>>;
type Checkpoint = { protocol: 1; sessionId: string; resumeState: Awaited<ReturnType<NativeSession["detach"]>>; workspace: Entry[] };
const [mode] = process.argv.slice(2);
assert(mode === "produce" || mode === "consume");
let raw = "";for await (const bytes of process.stdin) { raw += bytes;assert(Buffer.byteLength(raw) < 2 * 1024 * 1024); }
const input = JSON.parse(raw) as { sessionId: string; checkpoint?: Checkpoint };
assert.match(input.sessionId, /^[a-z0-9-]{1,100}$/);
const emit = (event: unknown) => new Promise<void>((done, reject) => process.stdout.write(`${JSON.stringify(event)}\n`, error => error ? reject(error) : done()));
await emit({ type: "resource-ready", sessionId: input.sessionId, pid: process.pid, node: process.version });

const fs = await createDiskWorkspace();
const diskPath = (path: string) => `${fs.root}${path === "/" ? "" : path}`;
if (mode === "consume") {
  assert(input.checkpoint?.protocol === 1);assert.equal(input.checkpoint.sessionId, input.sessionId);
  let size = 0;const seen = new Set<string>();
  const entries = input.checkpoint.workspace;assert(entries.length <= 4000);
  for (const entry of [...entries].sort((a, b) => Number(a.type === "symlink") - Number(b.type === "symlink") || a.path.length - b.path.length)) {
    assert.equal(posix.normalize(entry.path), entry.path);assert(entry.path.startsWith("/"));assert(!entry.path.includes("\0"));assert(!seen.has(entry.path));seen.add(entry.path);
    if (entry.type === "directory") await fs.mkdir(diskPath(entry.path), { recursive: true });
    else if (entry.type === "symlink") { assert(entry.target && !entry.target.includes("\0"));await fs.symlink(entry.target.startsWith("/") ? diskPath(entry.target) : entry.target, diskPath(entry.path)); }
    else { assert(entry.content !== undefined);const bytes = Buffer.from(entry.content, "base64");assert.equal(bytes.toString("base64"), entry.content);size += bytes.byteLength;assert(size <= 32 * 1024 * 1024);await fs.writeFile(diskPath(entry.path), bytes); }
    if (entry.type !== "symlink") await fs.chmod(diskPath(entry.path), entry.mode);
  }
}
await fs.mkdir(`${fs.root}/workspace`, { recursive: true });
let toolsExecuted = 0;
const requests: { messages: { role: string; tool_call_id?: string; content: unknown }[] }[] = [];
const provider = createServer(async (request, response) => {
  assert.equal(request.headers.authorization, "Bearer fixture-local-key");
  let body = "";for await (const bytes of request) body += bytes;
  requests.push(JSON.parse(body));
  response.writeHead(200, { "content-type": "text/event-stream" });
  const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "container-native-fixture", object: "chat.completion.chunk", created: 1,
    model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  if (mode === "produce") {
    const marking = requests.length === 1;
    send({ role: "assistant", tool_calls: [{ index: 0, id: marking ? "marker-1" : "question-1", type: "function", function: {
      name: marking ? "write_marker" : "askUserQuestions", arguments: JSON.stringify(marking ? {} : { allowPartialAnswers: false,
        questions: [{ id: "direction", question: "Which direction?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], allowFreeForm: true }] }),
    } }] });send({}, "tool_calls");
  } else { send({ role: "assistant", content: "Native answer B, no replay." });send({}, "stop"); }
  response.end("data: [DONE]\n\n");
});
await new Promise<void>(done => provider.listen(0, "127.0.0.1", done));
const address = provider.address();assert(address && typeof address !== "string");
const agent = createHarnessAgent(createPiAdapter({ providerId: "fixture", apiKey: "fixture-local-key", baseUrl: `http://127.0.0.1:${address.port}/v1`,
  model: { id: "fixture", contextWindow: 262144, maxTokens: 1024, reasoning: false }, maxTokensField: "max_tokens" }), {
  instructions: "Execute the marker once, then ask direction. Use native tool continuation.", stopWhen: [],
  tools: { write_marker: tool({ inputSchema: z.object({}), execute: async () => {
    toolsExecuted++;let count = 0;try { count = Number(await fs.readFile(`${fs.root}/workspace/marker.txt`)); } catch { /* new workspace */ }
    await fs.writeFile(`${fs.root}/workspace/marker.txt`, String(count + 1));return { count: count + 1 };
  } }) },
});
const adapter = createLocalSandboxAdapter({ cwd: `${fs.root}/workspace`, env: {}, createFilesystem: async () => fs, restoreFilesystem: async () => fs });
const sandbox = mode === "consume" ? await adapter.resume({ sandboxId: `sandbox-${input.sessionId}` }) : await adapter.create({ sandboxId: `sandbox-${input.sessionId}` });
const session = await agent.createSession({ sessionId: input.sessionId, sandboxSession: sandbox.session, ...(input.checkpoint ? { resumeFrom: input.checkpoint.resumeState } : {}) });
try {
  if (mode === "produce") {
    const result = await agent.stream({ session, prompt: "Write marker exactly once and ask direction." });for await (const _chunk of result.stream) { /* official loop */ }
    assert(session.hasUnfinishedTurn());assert.equal(toolsExecuted, 1);assert.equal(requests.length, 2);
    const resumeState = await session.detach();assert.equal(resumeState.continueFrom?.pendingToolResults?.[0].toolCallId, "question-1");
    const workspace: Entry[] = [];
    for (const path of fs.getAllPaths()) {
      const stat = await fs.lstat(path);const entry: Entry = { path: path === fs.root ? "/" : path.slice(fs.root.length), mode: stat.mode & 0o7777, type: stat.isDirectory ? "directory" : stat.isSymbolicLink ? "symlink" : "file" };
      if (entry.type === "file") entry.content = Buffer.from(await fs.readFileBuffer(path)).toString("base64");
      if (entry.type === "symlink") { const target = await fs.readlink(path);assert(!target.startsWith("/") || target.startsWith(`${fs.root}/`));entry.target = target.startsWith("/") ? target.slice(fs.root.length) : target; }
      workspace.push(entry);
    }
    const checkpoint: Checkpoint = { protocol: 1, sessionId: input.sessionId, resumeState, workspace };
    assert(Buffer.byteLength(JSON.stringify(checkpoint)) < 128 * 1024);
    await emit({ type: "checkpoint", checkpoint, toolsExecuted, providerCalls: requests.length, marker: await fs.readFile(`${fs.root}/workspace/marker.txt`) });
    // Actual process exit; no live agent or process Map can serve the continuation.
    await sandbox.session.destroy();
    process.exit(0);
  }
  assert(session.hasUnfinishedTurn());
  const answer = { action: "answered", answers: { direction: { optionIds: ["b"] } } };
  const result = await agent.continueStream({ session, toolResultContinuations: [{ type: "tool-result", toolCallId: "question-1", toolName: "askUserQuestions", output: { type: "json", value: answer } }] });
  let text = "";for await (const chunk of result.stream) if (chunk.type === "text-delta") text += chunk.text;
  assert.equal(text, "Native answer B, no replay.");assert.equal(toolsExecuted, 0);assert.equal(await fs.readFile(`${fs.root}/workspace/marker.txt`), "1");assert(!session.hasUnfinishedTurn());
  assert.equal(requests.length, 1);const history = requests[0].messages;
  assert.equal(history.filter(message => message.role === "user").length, 1);
  assert.equal(history.filter(message => message.tool_call_id === "marker-1").length, 1);
  const questions = history.filter(message => message.tool_call_id === "question-1");assert.equal(questions.length, 1);assert.deepEqual(JSON.parse(questions[0].content as string), answer);
  await session.stop();await session.destroy();await sandbox.session.destroy();
  await emit({ type: "completed", text, toolsExecuted, marker: "1", providerCalls: 1, nativeAnswer: answer });
} finally {
  await sandbox.session.destroy();
  provider.closeAllConnections();await new Promise<void>(done => provider.close(() => done()));
}
