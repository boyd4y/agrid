import assert from "node:assert/strict";
import { after, before, test } from "../runtime.js";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { eq } from "drizzle-orm";
import { tool, type UIMessage } from "ai";
import { z } from "zod";
import type { HarnessAgentResumeSessionState } from "@ai-sdk/harness/agent";
import type { Actor } from "../../src/auth/actor.js";

if (!process.env.DATABASE_URL?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "PI_API_KEY", "PI_BASE_URL"]) process.env[key] = "";
const { db, client } = await import("../../src/db/index.js");
const { user, organization, member, agentProfile, chatThreads, agentRuntimeSessions, agentRuns } = await import("../../src/db/schema.js");
const { loadMessages, saveMessage } = await import("../../src/chat/store.js");
const { beginNativeRun, listNativeRuns, requestRunCancellation } = await import("../../src/harness/runs.js");
const { claimRuntimeLease, prepareRuntimeRecord, releaseRuntimeLease, NOT_INVOKED } = await import("../../src/harness/store.js");
const { createNativeChatStream } = await import("../../src/harness/chat-stream.js");
const { createNativeAgent, openNativeSandbox } = await import("../../src/harness/runtime.js");
const org = randomUUID(), owner = randomUUID(), agentUser = randomUUID(), agentMember = randomUUID(), profileId = randomUUID();
const actor: Actor = { kind: "human", userId: owner, organizationId: org, memberId: owner, role: "owner", name: "Startup fixture", email: `${owner}@local.test` };
before(async () => {
  await db.insert(user).values([{ id: owner, email: actor.email, name: actor.name }, { id: agentUser, email: `${agentUser}@local.test`, name: "Pi fixture", kind: "agent" }]);
  await db.insert(organization).values({ id: org, name: "Startup fixture", slug: org });
  await db.insert(member).values([{ id: actor.memberId, userId: owner, organizationId: org, role: "owner" }, { id: agentMember, userId: agentUser, organizationId: org }]);
  await db.insert(agentProfile).values({ id: profileId, userId: agentUser, organizationId: org, memberId: agentMember, displayName: "Pi fixture" });
});
after(async () => {
  await db.delete(organization).where(eq(organization.id, org));
  for (const id of [owner, agentUser]) await db.delete(user).where(eq(user.id, id));
  await client.end();
});
async function newThread() {
  const [thread] = await db.insert(chatThreads).values({ userId: owner, organizationId: org, clientId: randomUUID(), custom: { resourceKey: "workspace" } }).returning();
  return thread.id;
}
async function prepare(threadId: string, prompt: string) {
  const lease = await claimRuntimeLease(threadId, actor);
  try {
    const record = await prepareRuntimeRecord(lease, actor, { profileId, harness: "pi", mode: "local" });
    const history = await loadMessages(threadId, actor);
    const message: UIMessage = { id: randomUUID(), role: "user", parts: [{ type: "text", text: prompt }] };
    const run = await beginNativeRun(lease, actor, record, { id: message.id, parentId: history.headId, format: "ai-sdk/v6", content: { role: "user", parts: message.parts } }, agentMember);
    return { lease, record, run, message, prompt };
  } catch (error) { await releaseRuntimeLease(lease);throw error; }
}
async function consume(prepared: Awaited<ReturnType<typeof prepare>>, tools = {}, signal?: AbortSignal) {
  const reader = createNativeChatStream({ ...prepared, actor, harness: "pi", modelId: "local-test", instructions: "Use only real fixture tools", tools, skills: [], messages: [prepared.message], metadata: {}, signal }).getReader();
  const chunks = [];
  try { for (;;) { const result = await reader.read();if (result.done) break;chunks.push(result.value); } }
  finally { reader.releaseLock(); }
  return JSON.stringify(chunks);
}
async function runtime(threadId: string) {
  const [record] = await db.select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.threadId, threadId));return record;
}

// A deterministic HTTP provider drives the official Pi runtime; the host mutation
// counter and native journal, rather than mocked sessions, detect tool replay.
test("Pi startup failures and early cancellation retain native state and allow only a new input", { timeout: 20000 }, async () => {
  const calls: { messages: { role: string; content: unknown }[] }[] = [];
  let mode = "complete", inMode = 0, mutations = 0;
  const tools = { mutate_fixture: tool({ inputSchema: z.object({}), execute: async () => ({ committed: ++mutations }) }), read_fixture: tool({ inputSchema: z.object({}), execute: async () => ({ committed: mutations }) }) };
  const provider = createServer(async (request, response) => {
    let raw = "";for await (const chunk of request) raw += chunk;
    calls.push(JSON.parse(raw));inMode++;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const write = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "startup-fixture", object: "chat.completion.chunk", created: 1, model: "local-test", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (mode === "suspend" && inMode > 2) { write({ role: "assistant", content: "Pause boundary" });return; }
    const name = mode === "complete" && inMode === 1 || mode === "suspend" && inMode === 1 ? "mutate_fixture" : mode === "suspend" && inMode === 2 ? "read_fixture" : null;
    if (name) { write({ role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function", function: { name, arguments: "{}" } }] });write({}, "tool_calls"); }
    else { write({ role: "assistant", content: "Native result retained" });write({}, "stop"); }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();assert(address && typeof address !== "string");
  process.env.PI_API_KEY = "local-fixture";process.env.PI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  const previousSteps = process.env.AI_CHAT_MAX_STEPS;process.env.AI_CHAT_MAX_STEPS = "2";
  try {
    const threadId = await newThread();
    const cancelled = await prepare(threadId, "NEVER_SUBMITTED_INITIAL");
    const cancelledOutput = await consume(cancelled, tools, AbortSignal.abort(new DOMException("Early stop", "AbortError")));
    assert.match(cancelledOutput, /"type":"abort"/);
    assert.doesNotMatch(cancelledOutput, /系统提示/);
    assert.equal(calls.length, 0);assert.equal(mutations, 0);
    let record = await runtime(threadId);assert.equal(record.resumeState, null);assert.equal(record.workspace, null);
    assert.equal(record.lastUserMessageId, cancelled.run.userMessageId);assert.equal(record.lastAssistantMessageId, cancelled.run.assistantMessageId);
    assert.equal((await listNativeRuns(threadId, actor))[0].status, "cancelled");
    const failureMessage = (await loadMessages(threadId, actor)).messages.at(-1)!;
    assert.deepEqual(failureMessage.content.metadata, { runId: cancelled.run.id, nativeInvocation: NOT_INVOKED });
    // Client saves cannot replace the server's proof, or the final text.
    await saveMessage(threadId, actor, { ...failureMessage, content: { role: "assistant", metadata: { nativeInvocation: "forged" } } });
    assert.deepEqual((await loadMessages(threadId, actor)).messages.at(-1)?.content, failureMessage.content);
    const initialFailure = await prepare(threadId, "NEVER_SUBMITTED_INITIAL_FAILURE");process.env.PI_API_KEY = "";
    assert.match(await consume(initialFailure, tools), /本轮未能启动/);process.env.PI_API_KEY = "local-fixture";
    record = await runtime(threadId);assert.equal(record.resumeState, null);assert.equal(record.workspace, null);
    assert.equal((await listNativeRuns(threadId, actor))[0].status, "failed");assert.equal(calls.length, 0);
    const first = await prepare(threadId, "FIRST_ACTUAL_NATIVE_INPUT");await consume(first, tools);
    assert.equal(calls.length, 2);assert.equal(mutations, 1);
    assert(!JSON.stringify(calls).includes("NEVER_SUBMITTED_INITIAL"));
    record = await runtime(threadId);assert(record.resumeState);assert(record.workspace?.length);
    const oldState = structuredClone(record.resumeState), oldWorkspace = structuredClone(record.workspace), oldSandbox = record.sandboxId;

    // A native attach/stop without submitting a prompt must retain the journal identity.
    const agent = createNativeAgent({ harness: "pi", mode: "local", modelId: "local-test", tools, skills: [], instructions: "Fixture" });
    const opened = await openNativeSandbox({ agent, mode: "local", sandboxId: record.sandboxId, hasResumeState: true, workspace: record.workspace });
    const session = await agent.createSession({ sessionId: record.sessionId, sandboxSession: opened.sandbox, resumeFrom: oldState as HarnessAgentResumeSessionState });
    assert.deepEqual((await session.stop()).data, oldState.data, "uninvoked SDK stop retains the original native journal");await opened.sandbox.destroy();
    assert.equal(calls.length, 2);

    // Cancellation is durable before execute but is checked after actual createSession.
    const earlyStop = await prepare(threadId, "NEVER_SUBMITTED_AFTER_HISTORY");await requestRunCancellation(threadId, earlyStop.run.id, actor);
    const earlyStopOutput = await consume(earlyStop, tools);
    assert.match(earlyStopOutput, /"type":"abort"/);
    assert.doesNotMatch(earlyStopOutput, /系统提示/);
    record = await runtime(threadId);assert.deepEqual(record.resumeState, oldState);assert.deepEqual(record.workspace, oldWorkspace);assert.equal(record.sandboxId, oldSandbox);
    assert.equal((await listNativeRuns(threadId, actor))[0].status, "cancelled");assert.equal(calls.length, 2);assert.equal(mutations, 1);

    // A genuine configuration failure before native construction also preserves the state.
    const failed = await prepare(threadId, "NEVER_SUBMITTED_STARTUP_FAILURE");process.env.PI_API_KEY = "";
    assert.match(await consume(failed, tools), /本轮未能启动/);process.env.PI_API_KEY = "local-fixture";
    record = await runtime(threadId);assert.deepEqual(record.resumeState, oldState);assert.deepEqual(record.workspace, oldWorkspace);
    assert.equal((await listNativeRuns(threadId, actor))[0].status, "failed");assert.equal(calls.length, 2);
    mode = "resumed";inMode = 0;
    const retry = await prepare(threadId, "ONLY_THIS_NEW_INPUT");await consume(retry, tools);
    const nativeHistory = JSON.stringify(calls.at(-1));
    assert.match(nativeHistory, /FIRST_ACTUAL_NATIVE_INPUT/);assert.match(nativeHistory, /committed/);assert.match(nativeHistory, /ONLY_THIS_NEW_INPUT/);
    assert(!nativeHistory.includes("NEVER_SUBMITTED"));assert.equal(mutations, 1);

    // Restored unfinished sessions accept an actual follow-up through official
    // continuation instead of requiring a fixed command or replaying old tools.
    mode = "suspend";inMode = 0;
    const suspendedThread = await newThread(), suspended = await prepare(suspendedThread, "SUSPENDED_NATIVE_INPUT");
    const suspendedChunks = await consume(suspended, tools);
    assert(!suspendedChunks.includes('"id":"run-note"') && !suspendedChunks.includes("达到配置的 2 步上限"), "suspension preserves native results without inserting assistant prose");
    const suspendedState = await runtime(suspendedThread);assert(suspendedState.resumeState?.continueFrom);assert.equal(mutations, 2);
    const pausedCalls = calls.length;
    assert.equal((await listNativeRuns(suspendedThread, actor))[0].canContinue, true);
    mode = "continued";inMode = 0;
    const followUp = "FOLLOW_UP_INCLUDE_THE_VERIFIED_TOTAL_AND_EXPLAIN_THE_SCOPE";
    assert.match(await consume(await prepare(suspendedThread, followUp), tools), /Native result retained/);
    assert.equal(calls.length, pausedCalls + 1);assert.equal(mutations, 2);
    const continuedUsers = calls.at(-1)!.messages.filter((message) => message.role === "user");
    assert(JSON.stringify(continuedUsers.at(-1)?.content).includes(followUp), `official continuation receives the actual follow-up, not an empty input: ${JSON.stringify(continuedUsers)}`);
    assert(JSON.stringify(calls.at(-1)).includes("SUSPENDED_NATIVE_INPUT"));
    assert(JSON.stringify(calls.at(-1)).includes("committed"));
    assert.equal((await listNativeRuns(suspendedThread, actor))[0].status, "completed");
  } finally {
    process.env.PI_API_KEY = "";process.env.PI_BASE_URL = "";
    if (previousSteps === undefined) delete process.env.AI_CHAT_MAX_STEPS;else process.env.AI_CHAT_MAX_STEPS = previousSteps;
    provider.closeAllConnections();await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});

test("untrusted proof and unknown or damaged checkpoints cannot enable history replay", async () => {
  const threadId = await newThread();
  const first = await prepare(threadId, "Unknown interrupted turn");
  await db.update(agentRuns).set({ status: "failed", endedAt: new Date() }).where(eq(agentRuns.id, first.run.id));
  await saveMessage(threadId, actor, { id: first.run.assistantMessageId, parentId: first.run.userMessageId, format: "ai-sdk/v6", content: { role: "assistant", metadata: { runId: first.run.id, nativeInvocation: NOT_INVOKED } } });
  await releaseRuntimeLease(first.lease);
  await assert.rejects(prepare(threadId, "Retry unsafe history"), /历史消息已保留/);

  const damagedThread = await newThread(), interrupted = await prepare(damagedThread, "SDK-incompatible old checkpoint");
  await db.update(agentRuns).set({ status: "completed", endedAt: new Date() }).where(eq(agentRuns.id, interrupted.run.id));
  await saveMessage(damagedThread, actor, { id: interrupted.run.assistantMessageId, parentId: interrupted.run.userMessageId, format: "ai-sdk/v6", content: { role: "assistant", parts: [{ type: "text", text: "Old reply" }] } }, true);
  await db.update(agentRuntimeSessions).set({ resumeState: { type: "resume-session", harnessId: "fixture-incompatible-harness", specificationVersion: "harness-v1", data: { opaque: "unchanged" } }, workspace: [], lastUserMessageId: interrupted.run.userMessageId, lastAssistantMessageId: interrupted.run.assistantMessageId }).where(eq(agentRuntimeSessions.id, interrupted.record.id));
  await releaseRuntimeLease(interrupted.lease);
  // Use a public SDK envelope mismatch, not platform knowledge of Pi's data.
  process.env.PI_API_KEY = "local-fixture";process.env.PI_BASE_URL = "http://127.0.0.1:9/v1";
  try {
    const attempted = await prepare(damagedThread, "Never replace an SDK-rejected session");
    const output = await consume(attempted);
    assert.match(output, /Lifecycle state was produced by harness 'fixture-incompatible-harness'/);
    assert.doesNotMatch(output, /本轮未能启动/);
    const [run] = await listNativeRuns(damagedThread, actor);assert.equal(run.status, "failed");assert.equal(run.canContinue, false);
  } finally { process.env.PI_API_KEY = "";process.env.PI_BASE_URL = ""; }
  const record = await runtime(damagedThread);
  assert.equal(record.lastUserMessageId, interrupted.run.userMessageId);assert.deepEqual(record.resumeState?.data, { opaque: "unchanged" });assert.equal(record.resumeState?.harnessId, "fixture-incompatible-harness");assert.deepEqual(record.workspace, []);
  const history = await loadMessages(damagedThread, actor);assert.equal(history.messages.at(-1)?.content.metadata, undefined);
  await assert.rejects(prepare(damagedThread, "Cannot bypass unknown checkpoint"), /执行因服务中断/);
});
