import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

test("official Pi clean question continuation survives producer process exit without host tool replay", { timeout: 20000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "tabdo-question-process-")), stateFile = join(directory, "state.json"), sessionId = randomUUID();
  const requests: { messages: { role: string; content: unknown; tool_call_id?: string }[] }[] = [];
  const question = { allowPartialAnswers: false, questions: [{ id: "direction", question: "Which direction?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], allowFreeForm: true }] };
  const answer = { action: "answered", answers: { direction: { optionIds: ["b"] } } };
  const provider = createServer(async (request, response) => {
    let raw = "";for await (const part of request) raw += part;requests.push(JSON.parse(raw));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "question-process", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (requests.length <= 2) {
      const name = requests.length === 1 ? "write_marker" : "askUserQuestions", id = requests.length === 1 ? "marker-1" : "question-1";
      send({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(requests.length === 1 ? {} : question) } }] });send({}, "tool_calls");
    } else { send({ role: "assistant", content: "Native answer B, no replay." });send({}, "stop"); }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();assert(address && typeof address !== "string");const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const serverRoot = resolve(import.meta.dirname, "../..");
  const run = (mode: string) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--conditions=development", "--import", "tsx", join(import.meta.dirname, "questions-process-worker.ts"), mode, baseUrl, stateFile, sessionId], { cwd: serverRoot, env: { PATH: process.env.PATH, NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";child.stdout.on("data", (part) => { output += part; });child.stderr.on("data", (part) => { output += part; });
    child.on("error", reject);child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Question ${mode} exited ${code}: ${output}`)));
  });
  try {
    await run("produce");assert.equal(requests.length, 2);
    await run("consume");assert.equal(requests.length, 3);
    const history = requests.at(-1)!.messages;assert.equal(history.filter((message) => message.role === "user").length, 1);
    const results = history.filter((message) => message.role === "tool" && message.tool_call_id === "question-1");assert.equal(results.length, 1);assert.deepEqual(JSON.parse(results[0].content as string), answer);
    assert.equal(history.filter((message) => message.role === "tool" && message.tool_call_id === "marker-1").length, 1);
  } finally {
    provider.closeAllConnections();await new Promise<void>((resolve) => provider.close(() => resolve()));await rm(directory, { recursive: true, force: true });
  }
});
