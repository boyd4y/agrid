import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { tool, type UIMessage } from "ai";
import { z } from "zod";
import type { Actor } from "../../src/auth/actor.js";

if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
for (const key of ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "PI_API_KEY", "PI_BASE_URL"]) process.env[key] = "";
const { db, client } = await import("../../src/db/index.js");
const { user, organization, member, agentProfile, chatThreads, chatMessages, agentRuns, agentRuntimeSessions, agentThreadLeases } = await import("../../src/db/schema.js");
const { loadMessages } = await import("../../src/chat/store.js");
const { beginNativeRun } = await import("../../src/harness/runs.js");
const { claimRuntimeLease, prepareRuntimeRecord, releaseRuntimeLease } = await import("../../src/harness/store.js");
const { executeNativeRun } = await import("../../src/harness/execution.js");
const { createNativeChatStream } = await import("../../src/harness/chat-stream.js");
const org = randomUUID(), owner = randomUUID(), agentUser = randomUUID(), agentMember = randomUUID(), profileId = randomUUID();
const actor: Actor = { kind: "human", userId: owner, memberId: owner, organizationId: org, role: "owner", name: "Execution fixture", email: `${owner}@local.test` };
let mutations = 0, releaseModel: (() => void) | undefined, enteredModel: (() => void) | undefined;
const requests: { messages: { role: string; tool_call_id?: string }[] }[] = [];
const tools = { mutate_fixture: tool({ inputSchema: z.object({}), execute: async () => ({ committed: ++mutations }) }) };
const provider = createServer(async (request, response) => {
  let raw = "";for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);requests.push(body);
  if (enteredModel) {
    const entered = enteredModel;enteredModel = undefined;
    await new Promise<void>(resolve => { releaseModel = resolve;entered(); });
  }
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "execution-fixture", object: "chat.completion.chunk", created: 1, model: "local-test", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  if (!body.messages.some((message: { tool_call_id?: string }) => message.tool_call_id === "native-mutation")) {
    send({ role: "assistant", tool_calls: [{ index: 0, id: "native-mutation", type: "function", function: { name: "mutate_fixture", arguments: "{}" } }] });send({}, "tool_calls");
  } else { send({ role: "assistant", content: "Execution and checkpoint completed." });send({}, "stop"); }
  response.end("data: [DONE]\n\n");
});
before(async () => {
  await db.insert(user).values([{ id: owner, name: actor.name, email: actor.email }, { id: agentUser, name: "Executor", email: `${agentUser}@local.test`, kind: "agent" }]);
  await db.insert(organization).values({ id: org, name: "Execution fixture", slug: org });
  await db.insert(member).values([{ id: owner, userId: owner, organizationId: org, role: "owner" }, { id: agentMember, userId: agentUser, organizationId: org }]);
  await db.insert(agentProfile).values({ id: profileId, userId: agentUser, organizationId: org, memberId: agentMember, displayName: "Executor" });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();assert(address && typeof address !== "string");
  process.env.PI_API_KEY = "fixture";process.env.PI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
});
after(async () => {
  releaseModel?.();provider.closeAllConnections();await new Promise<void>(resolve => provider.close(() => resolve()));
  await db.delete(organization).where(eq(organization.id, org));
  await db.delete(user).where(inArray(user.id, [owner, agentUser]));
  await client.end();
});
async function prepare(threadId?: string) {
  if (!threadId) threadId = (await db.insert(chatThreads).values({ userId: owner, organizationId: org, clientId: randomUUID(), custom: { resourceKey: "workspace" } }).returning())[0].id;
  const lease = await claimRuntimeLease(threadId, actor);
  try {
    const record = await prepareRuntimeRecord(lease, actor, { profileId, harness: "pi", mode: "local" });
    const history = await loadMessages(threadId, actor);
    const message: UIMessage = { id: randomUUID(), role: "user", parts: [{ type: "text", text: "Do one mutation, then describe the result." }] };
    const run = await beginNativeRun(lease, actor, record, { id: message.id, parentId: history.headId, format: "ai-sdk/v6", content: { role: "user", parts: message.parts } }, agentMember);
    return { actor, lease, record, run, harness: "pi" as const, modelId: "local-test", instructions: "Use the fixture tool once.", tools, skills: [], prompt: "Do one mutation, then describe the result.", messages: [message], metadata: {} };
  } catch (error) { await releaseRuntimeLease(lease);throw error; }
}
async function assertSaved(input: Awaited<ReturnType<typeof prepare>>) {
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, input.run.id));
  assert.equal(run.status, "completed", run.error ?? "");assert.equal(run.cancelRequestedAt, null);
  const [runtime] = await db.select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.id, input.record.id));
  assert(runtime.resumeState);assert(runtime.workspace?.length);assert.equal(runtime.lastAssistantMessageId, run.assistantMessageId);
  const history = await loadMessages(input.lease.threadId, actor);
  assert.equal(history.messages.at(-1)?.id, run.assistantMessageId);
  const [saved] = await db.select().from(chatMessages).where(and(eq(chatMessages.threadId, input.lease.threadId), eq(chatMessages.messageId, run.assistantMessageId)));
  assert(saved.serverFinal);assert.match(JSON.stringify(history.messages.at(-1)?.content), /Execution and checkpoint completed/);
  const [lease] = await db.select().from(agentThreadLeases).where(eq(agentThreadLeases.threadId, input.lease.threadId));
  assert.equal(lease.token, null, "execution resolves only after its lease has been released");
}

test("headless execution awaits the saved checkpoint and release; the next native Run does not replay its tool", { timeout: 20000 }, async () => {
  const input = await prepare(), initial = mutations, calls = requests.length;
  await executeNativeRun(input);
  await assertSaved(input);assert.equal(mutations, initial + 1);assert.equal(requests.length, calls + 2);
  const next = await prepare(input.lease.threadId);
  await executeNativeRun(next);
  await assertSaved(next);assert.equal(mutations, initial + 1);assert.equal(requests.length, calls + 3);
});

test("cancelling the browser stream only detaches its projection and preserves the accepted native operation", { timeout: 20000 }, async () => {
  const input = await prepare(), initial = mutations;
  const entered = new Promise<void>(resolve => { enteredModel = resolve; });
  const reader = createNativeChatStream(input).getReader();
  try {
    await reader.read();await entered;
    await reader.cancel("browser closed");
    const [running] = await db.select().from(agentRuns).where(eq(agentRuns.id, input.run.id));
    assert.equal(running.cancelRequestedAt, null);assert.notEqual(running.status, "cancelled");
  } finally { reader.releaseLock();releaseModel?.();releaseModel = undefined; }
  const deadline = Date.now() + 10000;
  for (;;) {
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, input.run.id));
    const [lease] = await db.select().from(agentThreadLeases).where(eq(agentThreadLeases.threadId, input.lease.threadId));
    if (run.endedAt && lease.token === null) break;
    assert(Date.now() < deadline, "detached execution must complete and release its resources");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await assertSaved(input);assert.equal(mutations, initial + 1);
});

test("a closed output adapter detaches without failing or replaying the native execution", { timeout: 20000 }, async () => {
  const input = await prepare(), initial = mutations;let attempts = 0;
  await executeNativeRun(input, { write() { attempts++;throw new Error("closed subscriber"); } });
  assert.equal(attempts, 1);await assertSaved(input);assert.equal(mutations, initial + 1);
});
