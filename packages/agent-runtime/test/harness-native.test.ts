import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { tool, jsonSchema } from "ai";
import { createDiskWorkspace } from "../src/sandbox/workspace.js";
import { createLocalSandboxAdapter } from "@tabdo/agent-runtime/sandbox/local";
import { createHarnessAgent } from "../src/harness/agent.js";
import { createPiAdapter } from "../src/harness/pi.js";

for (const finalFailure of [false, true]) test(`native Pi retry ${finalFailure ? "preserves a later terminal failure" : "recovers an earlier timeout without a false terminal error"}`, { timeout: 20000 }, async () => {
  const completions: string[] = [];
  let calls = 0, executed = 0;
  const provider = createServer(async (request, response) => {
    for await (const _ of request) { /* drain only this local protocol fixture */ }
    calls++;
    if (calls === 1 || finalFailure && calls === 3) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: calls === 1 ? "Request timed out." : "Permanent fixture rejection", type: "invalid_request_error" } }));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "native-retry", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (calls === 2) {
      send({ role: "assistant", tool_calls: [{ index: 0, id: "receipt-1", type: "function", function: { name: "receipt", arguments: "{}" } }] });send({}, "tool_calls");
    } else { send({ role: "assistant", content: "Recovered successfully." });send({}, "stop"); }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();assert(address && typeof address !== "string");
  const sandbox = await createLocalSandboxAdapter({ cwd: "/workspace", env: {} }).create();
  const agent = createHarnessAgent(createPiAdapter({ providerId: "retry-fixture", apiKey: "fixture-key", baseUrl: `http://127.0.0.1:${address.port}/v1`, model: { id: "fixture", contextWindow: 65536, maxTokens: 512, reasoning: false }, maxTokensField: "max_tokens", onMessageEnd: completion => completions.push(completion.finishReason) }), {
    instructions: "Use receipt once, then confirm.", tools: { receipt: tool({ inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {}, additionalProperties: false }), execute: () => { executed++;return { committed: true }; } }) },
  });
  const session = await agent.createSession({ sandboxSession: sandbox.session, sessionId: crypto.randomUUID() });
  try {
    const result = await agent.stream({ session, prompt: "Run the receipt once." });
    const parts = [];for await (const part of result.stream) parts.push(part);
    assert.equal(calls, 3);assert.equal(executed, 1, "native retries never replay the successful tool");
    assert.deepEqual(completions, ["error", "toolUse", finalFailure ? "error" : "stop"]);
    const errors = parts.filter(part => part.type === "error");
    if (finalFailure) { assert(errors.some(part => String(part.error).includes("Permanent fixture rejection")));assert(!parts.some(part => part.type === "finish")); }
    else { assert.equal(errors.length, 0, "a successful final attempt must clear the earlier retryable timeout");assert(parts.some(part => part.type === "finish"));assert.equal(parts.filter(part => part.type === "text-delta").map(part => part.text).join(""), "Recovered successfully."); }
  } finally {
    await session.stop().catch(() => {});await sandbox.session.destroy();
    provider.closeAllConnections();await new Promise<void>(resolve => provider.close(() => resolve()));
  }
});

test("standalone native agent executes a host tool and resumes native history without product imports", { timeout: 15000 }, async () => {
  const requests: { max_tokens?: number; messages: unknown[] }[] = [];
  const completions: string[] = [];
  let executed = 0;
  const provider = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer fixture-key");
    let raw = ""; for await (const part of request) raw += part;
    requests.push(JSON.parse(raw));
    response.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({
      id: "generic-fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    if (requests.length === 1) {
      send({ role: "assistant", tool_calls: [{ index: 0, id: "sum-1", type: "function", function: { name: "compute", arguments: '{"a":2,"b":3}' } }] });
      send({}, "tool_calls");
    } else { send({ role: "assistant", content: requests.length === 2 ? "Computed 5." : "Previous result was 5." }); send({}, "stop"); }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address(); assert(address && typeof address !== "string");
  const fs = await createDiskWorkspace(); await fs.mkdir("project", { recursive: true });
  const sandbox = await createLocalSandboxAdapter({ cwd: "/project", env: {}, createFilesystem: async () => fs }).create({ sandboxId: "standalone-fixture" });
  const makeAgent = () => createHarnessAgent(createPiAdapter({ providerId: "fixture", apiKey: "fixture-key",
    baseUrl: `http://127.0.0.1:${address.port}/v1`, model: { id: "fixture", contextWindow: 65536, maxTokens: 512, reasoning: false },
    maxTokensField: "max_tokens", onMessageEnd: (completion) => completions.push(completion.finishReason),
  }), { instructions: "Use compute once and remember the result.", sandboxConfig: { workDir: "work" },
    tools: { compute: tool({ inputSchema: jsonSchema<{ a: number; b: number }>({ type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"], additionalProperties: false }),
      execute: ({ a, b }) => { executed++; return { value: a + b }; } }) } });
  try {
    const first = makeAgent();
    const session = await first.createSession({ sandboxSession: sandbox.session, sessionId: "native-fixture" });
    assert.equal((await first.generate({ session, prompt: "Compute 2+3." })).text, "Computed 5.");
    const resumeFrom = await session.stop();
    const second = makeAgent();
    const resumed = await second.createSession({ sandboxSession: sandbox.session, sessionId: "native-fixture", resumeFrom });
    assert.equal((await second.generate({ session: resumed, prompt: "Recall the result." })).text, "Previous result was 5.");
    assert.equal(executed, 1);
    assert.equal(requests[0].max_tokens, 512);
    assert(JSON.stringify(requests.at(-1)?.messages).includes("Computed 5."));
    assert.equal(completions.at(-1), "stop");
    const workspaceFiles = await Promise.all(fs.getAllPaths().map(async (path) =>
      (await fs.lstat(path)).isFile ? Buffer.from(await fs.readFileBuffer(path)).toString("utf8") : ""));
    assert(!workspaceFiles.join("\n").includes("fixture-key"));
    await resumed.stop();
    await resumed.destroy();
  } finally {
    await sandbox.session.destroy();
    provider.closeAllConnections(); await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});
