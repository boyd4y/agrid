import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tool, stepCountIs } from "ai";
import { z } from "zod";
import { createNativeAgent, openNativeSandbox } from "../../src/harness/runtime.js";
import { snapshotWorkspace } from "../../src/harness/workspace.js";

test("old Pi resume blob plus newer complete journal starts a new turn without replaying nine completed tools", { timeout: 15000 }, async () => {
  const sessionId = `journal-recovery-${randomUUID()}`, sandboxId = `journal-sandbox-${randomUUID()}`;
  const hostRoot = join(tmpdir(), "ai-sdk-harness", "pi", sessionId);
  const calls: { messages: { role: string; content: unknown }[] }[] = [];
  let executed = 0;
  let reportToolResults!: () => void;
  const toolResultsReachedProvider = new Promise<void>((resolve) => { reportToolResults = resolve; });
  const http = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); calls.push(body);
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "local-test", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (calls.length === 11) {
      // A running model after all tool results, before final text/checkpoint.
      assert.equal(body.messages.filter((message: { role: string }) => message.role === "tool").length, 9);
      reportToolResults(); return;
    }
    send({ role: "assistant" });
    if (calls.length >= 2 && calls.length <= 10) {
      send({ tool_calls: [{ index: 0, id: `read_${calls.length - 2}`, type: "function", function: { name: "read_fixture", arguments: JSON.stringify({ index: calls.length - 2 }) } }] });
      send({}, "tool_calls");
    } else { send({ content: calls.length === 1 ? "First checkpoint" : "Recovered from nine results" }); send({}, "stop"); }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address(); assert(address && typeof address !== "string");
  const env = { PI_API_KEY: "local-fixture", PI_BASE_URL: `http://127.0.0.1:${address.port}/v1` };
  const makeAgent = () => createNativeAgent({ harness: "pi", mode: "local", env, modelId: "local-test", instructions: "Use only local fixture tools.", skills: [], stopWhen: stepCountIs(20), tools: { read_fixture: tool({ inputSchema: z.object({ index: z.number() }), execute: ({ index }) => { executed++; return { marker: `fixture-result-${index}` }; } }) } });
  const sandboxes: Awaited<ReturnType<typeof openNativeSandbox>>["sandbox"][] = [];
  try {
    const agent = makeAgent();
    const first = await openNativeSandbox({ agent, mode: "local", sandboxId, hasResumeState: false, env }); sandboxes.push(first.sandbox); assert(first.fs);
    const session = await agent.createSession({ sessionId, sandboxSession: first.sandbox });
    assert.equal((await agent.generate({ session, prompt: "First turn" })).text, "First checkpoint");
    const oldResume = await session.stop(), oldSnapshot = await snapshotWorkspace(first.fs);
    const oldResumeCopy = structuredClone(oldResume);
    const oldJournal = oldSnapshot.find((entry) => entry.type === "file" && entry.path.endsWith(".jsonl")); assert(oldJournal?.content);
    const fileName = oldJournal.path.split("/").at(-1)!;
    assert.equal((oldResume.data as { sessionFileName: string }).sessionFileName, fileName, "use exactly the basename referenced by unchanged opaque resume data");
    const agent2 = makeAgent();
    const second = await openNativeSandbox({ agent: agent2, mode: "local", sandboxId, hasResumeState: true, workspace: oldSnapshot, env }); sandboxes.push(second.sandbox);
    const session2 = await agent2.createSession({ sessionId, sandboxSession: second.sandbox, resumeFrom: oldResume });
    const pendingTurn = agent2.generate({ session: session2, prompt: "Read nine fixtures" }).catch(() => null);
    await toolResultsReachedProvider;
    const latestJournal = await readFile(join(hostRoot, "sessions", fileName));
    const entries = latestJournal.toString("utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(entries.filter((entry) => entry.message?.role === "toolResult").length, 9, "all completed tools are present in the native host journal before stop");
    const oldBytes = Buffer.from(oldJournal.content, "base64");
    assert(latestJournal.length > oldBytes.length && latestJournal.subarray(0, oldBytes.length).equals(oldBytes), "new journal is a strict byte prefix extension of the saved journal");
    const latestUser = entries.filter((entry) => entry.message?.role === "user").at(-1)?.message.content;
    assert.equal(typeof latestUser === "string" ? latestUser : latestUser?.filter((part: { type: string }) => part.type === "text").map((part: { text: string }) => part.text).join(""), "Read nine fixtures", "journal belongs to the interrupted fixture turn");
    assert.equal(entries.at(-1)?.message?.role, "toolResult", "recovery point ends after a complete result, before model output");
    const results = new Set(entries.filter((entry) => entry.message?.role === "toolResult").map((entry) => entry.message.toolCallId));
    const requested = entries.flatMap((entry) => entry.message?.role === "assistant" ? entry.message.content.filter((block: { type: string }) => block.type === "toolCall") : []);
    assert.equal(requested.length, 9); assert(requested.every((call: { id: string }) => results.has(call.id)), "no dangling host tool calls");
    assert.equal(executed, 9);
    assert(!Buffer.from(oldJournal.content, "base64").includes(Buffer.from("fixture-result-8")), "persisted sandbox snapshot is still the previous turn");
    // Dispose the isolated abandoned instance. Its new resume/snapshot are deliberately ignored.
    await session2.stop(); await pendingTurn;
    const recoverySnapshot = oldSnapshot.map((entry) => entry.path === oldJournal.path ? { ...entry, content: latestJournal.toString("base64") } : entry);
    const agent3 = makeAgent();
    const recovered = await openNativeSandbox({ agent: agent3, mode: "local", sandboxId, hasResumeState: true, workspace: recoverySnapshot, env }); sandboxes.push(recovered.sandbox);
    const session3 = await agent3.createSession({ sessionId, sandboxSession: recovered.sandbox, resumeFrom: oldResume });
    assert.equal(session3.hasUnfinishedTurn(), false, "the old completed resume blob permits a new user turn");
    const result = await agent3.generate({ session: session3, prompt: "Summarize the nine existing results without querying again" });
    assert.equal(result.text, "Recovered from nine results");
    const finalMessages = calls.at(-1)!.messages;
    assert.equal(finalMessages.filter((message) => message.role === "tool").length, 9);
    for (let index = 0; index < 9; index++) assert(JSON.stringify(finalMessages).includes(`fixture-result-${index}`));
    assert(JSON.stringify(finalMessages).includes("Read nine fixtures"));
    assert(JSON.stringify(finalMessages).includes("Summarize the nine existing results"));
    assert.equal(executed, 9, "official createSession/generate do not replay completed host tools");
    assert.deepEqual(oldResume, oldResumeCopy, "opaque resume state is passed through unchanged");
    await session3.stop();
    console.log("PASS official Pi: unchanged old resume + same journal basename + latest nine tool results; fresh turn sees all results, zero replay.");
  } finally {
    http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve()));
    await Promise.allSettled(sandboxes.map((sandbox) => sandbox.destroy()));
    await rm(hostRoot, { recursive: true, force: true });
  }
});
