import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { test } from "../runtime.js";
import { eq } from "drizzle-orm";
import { db, client } from "../../src/db/index.js";
import { organization, user, member, agentProfile, workspaces } from "../../src/db/schema.js";
import { admitAgentMemory, listAgentMemory, readAgentMemory, writeAgentMemory } from "../../src/business/agent/memory.js";
import type { Actor } from "../../src/auth/actor.js";

if (!new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
type Request = { messages: { role: string; content: unknown }[]; tools?: { function: { name: string } }[] };

test("producer process exits; actual fresh thread recalls scoped index and reads topic on demand", { timeout: 60000 }, async () => {
  const org = randomUUID(), owner = randomUUID(), bot = randomUUID(), membership = randomUUID(), profile = randomUUID();
  const requests: Request[] = [];
  const directory = await mkdtemp(join(tmpdir(), "tabdo-memory-"));
  let mode: "capture" | "recall" | "question" | "continue" = "capture", calls = 0;
  const bodyMarker = "fixture-private-body-quotation-total-first";
  const provider = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const request: Request = JSON.parse(raw); requests.push(request);calls++;
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: "memory-fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    const call = (name: string, args: unknown) => { send({ tool_calls: [{ index: 0, id: `memory-${mode}-${calls}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });send({}, "tool_calls"); };
    send({ role: "assistant" });
    if (mode === "capture" && calls === 1) {
      call("memory_write", { topic: "quotation.md", expectedRevision: null, name: "Quotation preference", description: "Quotation format preference", type: "feedback", body: bodyMarker });
    } else if (mode === "question" && calls === 1) {
      send({ tool_calls: [{ index: 0, id: "memory-question", type: "function", function: { name: "askUserQuestions", arguments: JSON.stringify({ allowPartialAnswers: false, questions: [{ id: "direction", question: "Which?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], allowMultiple: false }] }) } }] });send({}, "tool_calls");
    } else if (mode === "recall" && calls === 1) call("memory_read", { topic: "quotation.md" });
    else { send({ content: mode === "recall" && calls === 2 ? JSON.stringify(request.messages.filter(message => message.role === "tool")) : "fixture-done" });send({}, "stop"); }
    res.end("data: [DONE]\n\n");
  });
  const run = async (input: unknown) => {
    const child = spawn(process.execPath, ["--import", "tsx", "test/helpers/memory-process-worker.ts", JSON.stringify(input)], { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });child.stderr.on("data", chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
    try {
      const code = await new Promise<number | null>((resolve, reject) => { child.on("error", reject);child.on("exit", resolve); });
      assert.equal(code, 0, stderr);
      return JSON.parse(stdout) as { threadId: string; text: string; secondText?: string; failures: string[] };
    } finally { clearTimeout(timer); }
  };
  try {
    await db.insert(organization).values({ id: org, name: "Memory process fixture", slug: org });
    await db.insert(user).values([{ id: owner, name: "Owner", email: `${owner}@memory.test` }, { id: bot, name: "Agent", email: `${bot}@memory.test`, kind: "agent" }]);
    await db.insert(member).values([{ id: membership, userId: owner, organizationId: org, role: "owner" }, { id: bot, userId: bot, organizationId: org, role: "member" }]);
    await db.insert(agentProfile).values({ id: profile, organizationId: org, userId: bot, memberId: bot, displayName: "Memory Agent", persona: { skillNames: [], disabledTools: ["update_cell"] } });
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.organizationId, org));
    const actor: Actor = { kind: "human", organizationId: org, userId: owner, memberId: membership, workspaceId: workspace.id, role: "owner", name: "Owner", email: `${owner}@memory.test` };
    await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
    const address = provider.address(); assert(address && typeof address !== "string");
    const env = { PI_API_KEY: "fixture-only", PI_BASE_URL: `http://127.0.0.1:${address.port}/v1`, PI_MODEL: "fixture", PI_CONTEXT_WINDOW: "65536", PI_MAX_OUTPUT_TOKENS: "1024" };
    const input = { actor, agentId: bot, env };
    const producer = await run({ ...input, prompt: "Remember my quotation format." });
    assert.deepEqual(producer.failures, []);assert.equal(calls, 2);
    for (const name of ["memory_list", "memory_read", "memory_write", "memory_forget"]) assert(requests[0].tools?.some(tool => tool.function.name === name), "intrinsic memory host operations stay available");
    assert(!requests[0].tools?.some(tool => tool.function.name === "update_cell"), "ordinary tool exclusions still apply");
    const scope = await admitAgentMemory({ database: db }, actor, profile);
    assert.equal((await readAgentMemory({ database: db }, scope, { topic: "quotation.md" })).body, bodyMarker);
    assert(!JSON.stringify(requests[0].messages).includes(bodyMarker));
    assert.equal((JSON.stringify(requests[0].messages).match(/<tabdo_auto_memory>/g) ?? []).length, 1);
    mode = "recall";calls = 0;requests.length = 0;
    // Producer has terminated. No messages, session ID, resume state or filesystem is passed.
    const consumer = await run({ ...input, prompt: "What quotation style should I use?", secondPrompt: "Continue normally." });
    assert.notEqual(consumer.threadId, producer.threadId);assert.deepEqual(consumer.failures, []);
    assert.match(consumer.text, new RegExp(bodyMarker));assert.equal(calls, 3);
    assert(JSON.stringify(requests[0].messages).includes("quotation.md"));
    assert(!JSON.stringify(requests[0].messages).includes(bodyMarker), "only index is automatically loaded");
    for (const request of requests) assert.equal((JSON.stringify(request.messages).match(/<tabdo_auto_memory>/g) ?? []).length, 1);
    assert.equal((await listAgentMemory({ database: db }, scope)).topics.length, 1, "one committed write, no duplicated tool execution");
    mode = "question";calls = 0;requests.length = 0;
    const checkpoint = join(directory, "checkpoint.json");
    const paused = await run({ ...input, prompt: "Ask my direction.", checkpoint: { action: "produce", path: checkpoint } });
    assert.equal(calls, 1);
    const original = await readAgentMemory({ database: db }, scope, { topic: "quotation.md" });
    await writeAgentMemory({ database: db, uuid: randomUUID }, scope, { topic: original.topic, expectedRevision: original.revision, body: original.body, description: "index-changed-while-paused" });
    mode = "continue";calls = 0;requests.length = 0;
    const continued = await run({ ...input, prompt: "", checkpoint: { action: "consume", path: checkpoint } });
    assert.equal(continued.threadId, paused.threadId);assert.equal(calls, 1);
    assert.equal((JSON.stringify(requests[0].messages).match(/<tabdo_auto_memory>/g) ?? []).length, 1);
    assert(!JSON.stringify(requests[0].messages).includes("index-changed-while-paused"), "SDK preserves the paused turn instruction snapshot on cold restore");
    assert.equal(requests[0].messages.filter(message => message.role === "user").length, 1);
    assert.equal(requests[0].messages.filter(message => message.role === "tool").length, 1);
    assert.equal((await listAgentMemory({ database: db }, scope)).topics.length, 1);
  } finally {
    provider.closeAllConnections();await new Promise<void>(resolve => provider.close(() => resolve()));
    await db.delete(organization).where(eq(organization.id, org));
    for (const id of [owner, bot]) await db.delete(user).where(eq(user.id, id));
    await client.end();
    await rm(directory, { recursive: true, force: true });
  }
});
