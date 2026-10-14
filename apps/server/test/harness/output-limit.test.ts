import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "../runtime.js";
import { tool, type UIMessage } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Actor } from "../../src/auth/actor.js";
import { createNativeAgent, openNativeSandbox } from "../../src/harness/runtime.js";

type Completion = { finishReason: string; outputTokens: number; reasoningTokens: number };
type Request = { model: string; max_tokens?: number; max_completion_tokens?: number; reasoning?: { enabled?: boolean; effort?: string } };

// A local OpenRouter-compatible SSE provider drives the actual Pi adapter. This
// does not replace native events, contact OpenRouter, or require an application DB.
test("native Pi observes output limits without losing partial text or misclassifying stop", { timeout: 15000 }, async () => {
  const scenarios = [
    { reason: "length", text: "", thinking: "Reasoning exhausted the output budget.", output: 16384, providerReasoning: 16384 },
    { reason: "length", text: "已核对数据，但说明尚未完成", thinking: "Some reasoning before a partial response.", output: 16384, providerReasoning: 16000 },
    { reason: "stop", text: "已完成核对。", thinking: "", output: 7, providerReasoning: 0 },
  ];
  const requests: Request[] = [];
  const provider = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    requests.push(JSON.parse(raw));
    const scenario = scenarios[requests.length - 1];
    assert(scenario, "one real provider request per scenario");
    response.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null, usage?: unknown) => response.write(`data: ${JSON.stringify({
      id: "output-limit-fixture", object: "chat.completion.chunk", created: 1, model: "openrouter/free",
      choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}),
    })}\n\n`);
    send({ role: "assistant" });
    if (scenario.thinking) send({ reasoning_content: scenario.thinking });
    if (scenario.text) send({ content: scenario.text });
    send({}, scenario.reason, { prompt_tokens: 100, completion_tokens: scenario.output, total_tokens: 100 + scenario.output,
      completion_tokens_details: { reasoning_tokens: scenario.providerReasoning } });
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address(); assert(address && typeof address !== "string");
  const env = { OPENROUTER_API_KEY: "local-output-limit-fixture", OPENROUTER_BASE_URL: `http://127.0.0.1:${address.port}/v1` };
  try {
    for (const [index, scenario] of scenarios.entries()) {
      const completions: Completion[] = [];
      const agent = createNativeAgent({ harness: "pi", mode: "local", env, modelId: "openrouter/free", skills: [], tools: {},
        instructions: "Reply with verified results only.", onPiMessageEnd: (completion) => { completions.push(completion); } });
      const opened = await openNativeSandbox({ agent, mode: "local", sandboxId: `output-limit-${randomUUID()}`, hasResumeState: false, env });
      const session = await agent.createSession({ sessionId: `output-limit-${randomUUID()}`, sandboxSession: opened.sandbox });
      try {
        const result = await agent.generate({ session, prompt: `Output limit scenario ${index}` });
        assert.equal(result.text, scenario.text, "reasoning stays separate and partial final text survives the output limit");
        assert.equal(requests.length, index + 1, "observer never retries a truncated completion");
        assert.equal(requests[index].max_tokens ?? requests[index].max_completion_tokens, 16384, "actual native OpenRouter request receives the configured default budget");
        assert.deepEqual(requests[index].reasoning, { enabled: false, effort: "none" }, "dynamic router reasoning is explicitly disabled on the wire");
        assert.equal(completions.length, 1, "one official message_end notification per assistant completion");
        assert.equal(completions[0].finishReason, scenario.reason, "length remains length; a normal stop is not an output limit");
        assert.equal(completions[0].outputTokens, scenario.output, "native usage retains all completion tokens, including reasoning");
        assert.equal(completions[0].reasoningTokens, scenario.providerReasoning, "actual pi-coding-agent dependency exposes provider reasoning usage");
      } finally { await session.stop(); await opened.sandbox.stop(); }
    }
  } finally {
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});

test("native output-limit ChatStream persists partial text as failed and resumes a new input without tool replay", {
  timeout: 20000, skip: !process.env.DATABASE_URL,
}, async () => {
  assert(new URL(process.env.DATABASE_URL!).pathname.endsWith("_agent_test"), "Use a dedicated *_agent_test database");
  const { db, client } = await import("../../src/db/index.js");
  const { user, organization, member, agentProfile, chatThreads, agentRuntimeSessions } = await import("../../src/db/schema.js");
  const { loadMessages } = await import("../../src/chat/store.js");
  const { beginNativeRun, listNativeRuns } = await import("../../src/harness/runs.js");
  const { claimRuntimeLease, prepareRuntimeRecord, releaseRuntimeLease } = await import("../../src/harness/store.js");
  const { createNativeChatStream } = await import("../../src/harness/chat-stream.js");
  const org = randomUUID(), owner = randomUUID(), agentUser = randomUUID(), agentMember = randomUUID(), profileId = randomUUID();
  const actor: Actor = { kind: "human", userId: owner, organizationId: org, memberId: owner, role: "owner", name: "Output limit fixture", email: `${owner}@local.test` };
  const calls: { messages: { role: string; content: unknown }[] }[] = [];
  let executed = 0;
  const partial = "已核对真实结果，补充说明尚未完成";
  const provider = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    calls.push(JSON.parse(raw));
    response.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null, usage?: unknown) => response.write(`data: ${JSON.stringify({
      id: "output-limit-chat", object: "chat.completion.chunk", created: 1, model: "openrouter/free",
      choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}),
    })}\n\n`);
    send({ role: "assistant" });
    if (calls.length === 1) {
      send({ tool_calls: [{ index: 0, id: "verified-once", type: "function", function: { name: "get_output_fixture", arguments: "{}" } }] });
      send({}, "tool_calls");
    } else if (calls.length === 2) {
      send({ reasoning_content: "Reasoning consumed most of the output allowance." }); send({ content: partial });
      send({}, "length", { prompt_tokens: 100, completion_tokens: 16384, total_tokens: 16484, completion_tokens_details: { reasoning_tokens: 16000 } });
    } else {
      send({ content: "沿用已核对的结果，完成补充。" });
      send({}, "stop", { prompt_tokens: 200, completion_tokens: 10, total_tokens: 210 });
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address(); assert(address && typeof address !== "string");
  const previousEnv = new Map(["OPENROUTER_API_KEY", "OPENROUTER_BASE_URL"].map((name) => [name, process.env[name]]));
  process.env.OPENROUTER_API_KEY = "local-output-limit-chat";
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  try {
    await db.insert(user).values([{ id: owner, email: actor.email, name: actor.name }, { id: agentUser, email: `${agentUser}@local.test`, name: "Output fixture", kind: "agent" }]);
    await db.insert(organization).values({ id: org, name: "Output fixture", slug: org });
    await db.insert(member).values([{ id: actor.memberId, userId: owner, organizationId: org, role: "owner" }, { id: agentMember, userId: agentUser, organizationId: org }]);
    await db.insert(agentProfile).values({ id: profileId, userId: agentUser, organizationId: org, memberId: agentMember, displayName: "Output fixture" });
    const [thread] = await db.insert(chatThreads).values({ userId: owner, organizationId: org, clientId: randomUUID(), custom: { resourceKey: "workspace" } }).returning();
    const tools = { get_output_fixture: tool({ inputSchema: z.object({}), execute: () => ({ verified: ++executed }) }) };
    async function run(prompt: string) {
      const lease = await claimRuntimeLease(thread.id, actor);
      try {
        const record = await prepareRuntimeRecord(lease, actor, { profileId, harness: "pi", mode: "local" });
        const history = await loadMessages(thread.id, actor);
        const message: UIMessage = { id: randomUUID(), role: "user", parts: [{ type: "text", text: prompt }] };
        const run = await beginNativeRun(lease, actor, record, { id: message.id, parentId: history.headId, format: "ai-sdk/v6", content: { role: "user", parts: message.parts } }, agentMember);
        const reader = createNativeChatStream({ actor, lease, record, run, harness: "pi", modelId: "openrouter/free", piModel: { contextWindow: 200000, maxTokens: 16384, reasoning: false },
          instructions: "Verify the fixture only once. Keep the native history after an output limit.", tools, skills: [], prompt, messages: [message], metadata: {} }).getReader();
        const chunks = [];
        try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; chunks.push(chunk.value); } }
        finally { reader.releaseLock(); }
        return { run, chunks: JSON.stringify(chunks) };
      } catch (error) { await releaseRuntimeLease(lease); throw error; }
    }
    const first = await run("VERIFY_ONCE_OUTPUT_LIMIT");
    assert.equal(executed, 1); assert.equal(calls.length, 2);
    assert(first.chunks.includes(partial)); assert.match(first.chunks, /模型输出上限/);
    const firstRun = (await listNativeRuns(thread.id, actor))[0];
    assert.equal(firstRun.id, first.run.id); assert.equal(firstRun.status, "failed"); assert.match(firstRun.error ?? "", /输出上限/);
    const history = await loadMessages(thread.id, actor), assistant = history.messages.at(-1)!;
    assert(JSON.stringify(assistant.content).includes(partial), "partial response is retained in durable UI history");
    const metadata: unknown = assistant.content.metadata;
    assert(metadata && typeof metadata === "object" && "completion" in metadata, "completion metadata is persisted");
    assert.deepEqual((metadata as { completion: unknown }).completion, { finishReason: "length", outputTokens: 16384, reasoningTokens: 16000 });
    const [state] = await db.select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.threadId, thread.id));
    assert(state.resumeState); assert(state.workspace?.length); assert(!state.resumeState.continueFrom, "output limit is a ended native completion, not an unfinished tool step");
    const next = await run("NEW_INPUT_COMPLETE_THE_PARTIAL_REPLY");
    assert.equal(executed, 1, "the completed verification tool is not replayed"); assert.equal(calls.length, 3);
    const nativeHistory = JSON.stringify(calls[2].messages);
    assert.match(nativeHistory, /VERIFY_ONCE_OUTPUT_LIMIT/); assert.match(nativeHistory, /verified/);
    assert(nativeHistory.includes(partial)); assert.match(nativeHistory, /NEW_INPUT_COMPLETE_THE_PARTIAL_REPLY/);
    assert(!next.chunks.includes("模型输出上限"), "normal stop must not inherit the previous completion limit");
    const runs = await listNativeRuns(thread.id, actor);
    assert.equal(runs.find((value) => value.id === next.run.id)?.status, "completed");
    assert.equal(runs.find((value) => value.id === first.run.id)?.status, "failed");
  } finally {
    for (const [name, value] of previousEnv) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    provider.closeAllConnections(); await new Promise<void>((resolve) => provider.close(() => resolve()));
    try { await db.delete(organization).where(eq(organization.id, org)); for (const id of [owner, agentUser]) await db.delete(user).where(eq(user.id, id)); }
    finally { await client.end(); }
  }
});
