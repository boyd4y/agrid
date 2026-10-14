import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import type { UIMessage } from "ai";
import type { AskUserQuestionsOutput } from "@tabdo/shared";
import { createNodeProcessExecution } from "@tabdo/platform-node/execution/node-process";
import { createHttpExecution } from "@tabdo/core/execution/http";
import type { Actor } from "../../src/auth/actor.js";

if (!process.env.DATABASE_URL?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
for (const key of ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "PI_API_KEY", "PI_BASE_URL"]) process.env[key] = "";
const { nodeJobResources, withNodeResources } = await import("../../src/resources/node.js");
const { getDatabase } = await import("@tabdo/backend/resources");
const schema = await import("../../src/db/schema.js");
const { user, organization, member, agentProfile, chatThreads, tables, agentRuns, agentExecutions, agentThreadLeases } = schema;
const { claimRuntimeLease, prepareRuntimeRecord, releaseRuntimeLease } = await import("../../src/harness/store.js");
const { beginNativeRun, requestRunCancellation, listNativeRuns } = await import("../../src/harness/runs.js");
const { resumeQuestionRun } = await import("../../src/harness/questions.js");
const { createNativeExecutionHttpHost } = await import("../../src/runner/http-host.js");
const { acceptNativeExecution, loadNativeExecution, claimNativeExecution, readNativeExecutionOutput } = await import("../../src/runner/repository.js");

test("durable runner executes a native turn and cold question answer in separate processes without replay", { timeout: 40000 }, async () => withNodeResources(async () => {
  const db = getDatabase();
  const org = randomUUID(), owner = randomUUID(), agentUser = randomUUID(), agentMember = randomUUID(), profileId = randomUUID();
  const actor: Actor = { kind: "human", userId: owner, organizationId: org, memberId: owner, role: "owner", name: "Runner owner", email: `${owner}@local.test` };
  const requests: { messages: { role: string; content: unknown; tool_call_id?: string }[] }[] = [];
  const tableName = `runner-${randomUUID()}`;
  const question = { allowPartialAnswers: false, questions: [{ id: "direction", question: "Which direction?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], allowFreeForm: true }] };
  const answer: AskUserQuestionsOutput = { action: "answered", answers: { direction: { optionIds: ["b"] } } };
  const provider = createServer(async (request, response) => {
    let raw = "";for await (const part of request) raw += part;requests.push(JSON.parse(raw));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "durable-runner", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (requests.length <= 2) {
      const name = requests.length === 1 ? "create_table" : "askUserQuestions", id = requests.length === 1 ? "table-1" : "question-1";
      send({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(requests.length === 1 ? { name: tableName } : question) } }] });send({}, "tool_calls");
    } else { send({ role: "assistant", content: "Native answer B, no replay." });send({}, "stop"); }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>(done => provider.listen(0, "127.0.0.1", done));
  const address = provider.address();assert(address && typeof address !== "string");
  let diagnostics = "";
  const executor = createNodeProcessExecution({ executable: process.execPath, args: ["--import", "tsx", "src/runner/node-entry.ts"], cwd: resolve(import.meta.dirname, "../.."),
    env: { DATABASE_URL: process.env.DATABASE_URL!, DB_POOL_MAX: "2", NODE_ENV: "test", PI_API_KEY: "fixture", PI_BASE_URL: `http://127.0.0.1:${address.port}/v1`, PI_MODEL: "fixture",
      OPENROUTER_API_KEY: "", OPENAI_API_KEY: "", CODEX_API_KEY: "", ANTHROPIC_API_KEY: "", CLAUDE_API_KEY: "", AI_CHAT_MAX_STEPS: "10", AI_CHAT_TOTAL_MS: "20000" },
    onOutput: (_id, _channel, bytes) => { diagnostics += Buffer.from(bytes).toString(); } });
  const authentication = { secret: "private-runner-fixture-secret-at-least-32-bytes", audience: "native-runner-fixture" };
  const controlHost = createNativeExecutionHttpHost({ executor, authentication });
  const controlServer = createServer(async (incoming, outgoing) => {
    let body = "";for await (const bytes of incoming) body += bytes;
    const address = controlServer.address() as { port: number };
    const response = await controlHost(new Request(`http://127.0.0.1:${address.port}${incoming.url}`, { method: incoming.method, headers: incoming.headers as Record<string, string>, body }));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));outgoing.end(await response.text());
  });
  await new Promise<void>(done => controlServer.listen(0, "127.0.0.1", done));
  const controlAddress = controlServer.address();assert(controlAddress && typeof controlAddress !== "string");
  const endpoint = `http://127.0.0.1:${controlAddress.port}/executions`;
  const remoteExecutor = createHttpExecution({ endpoint, authentication, pollIntervalMs: 20 });
  const launchViaHttp = async (executionId: string) => {
    const handle = await remoteExecutor.start({ id: executionId, reference: { executionId } });
    assert.deepEqual(await handle.completion, { code: null, signal: null }, "private host certifies settled attempt, not physical exit code");
  };
  const launch = async (executionId: string) => {
    const process = await executor.start({ id: executionId, reference: { executionId } });
    assert.deepEqual(await process.completion, { code: 0, signal: null }, diagnostics);
  };
  try {
    await db.insert(user).values([{ id: owner, email: actor.email, name: actor.name }, { id: agentUser, email: `${agentUser}@local.test`, name: "Runner agent", kind: "agent" }]);
    await db.insert(organization).values({ id: org, name: "Runner fixture", slug: org });
    await db.insert(member).values([{ id: owner, userId: owner, organizationId: org, role: "owner" }, { id: agentMember, userId: agentUser, organizationId: org }]);
    await db.insert(agentProfile).values({ id: profileId, userId: agentUser, organizationId: org, memberId: agentMember, displayName: "Runner agent", persona: { defaultHarness: "pi", defaultModel: "fixture", runtime: "local", skillNames: [] } });
    const [thread] = await db.insert(chatThreads).values({ userId: owner, organizationId: org, clientId: randomUUID(), custom: { resourceKey: "workspace", agentId: agentMember } }).returning();
    const lease = await claimRuntimeLease(thread.id, actor);
    const record = await prepareRuntimeRecord(lease, actor, { profileId, harness: "pi", mode: "local" });
    const message: UIMessage = { id: randomUUID(), role: "user", parts: [{ type: "text", text: "Create one table and ask direction." }] };
    const run = await beginNativeRun(lease, actor, record, { id: message.id, parentId: null, format: "ai-sdk/v6", content: { role: "user", parts: message.parts } }, agentMember);
    const first = await acceptNativeExecution({ actor, lease, run, context: { page: "ai" }, prompt: "Create one table and ask direction." });
    assert.deepEqual(await acceptNativeExecution({ actor, lease, run, context: { page: "ai" }, prompt: "Create one table and ask direction." }), first);
    await assert.rejects(acceptNativeExecution({ actor, lease, run, context: { page: "ai" }, prompt: "Replace accepted input" }), /不能更换/);
    // A coordinator may die before dispatch: viewing history must not classify
    // a provably uninvoked accepted receipt as an interrupted SDK operation.
    await db.update(agentThreadLeases).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(agentThreadLeases.threadId, thread.id));
    assert.equal((await listNativeRuns(thread.id, actor))[0].status, "starting");
    await launch(first.executionId);
    assert.equal(requests.length, 2);
    const suspended = await loadNativeExecution(first.executionId);
    assert.equal(suspended.run.status, "suspended");assert.equal(suspended.execution.status, "settled");assert(suspended.record.resumeState?.continueFrom);
    assert.equal((await db.select().from(tables).where(and(eq(tables.organizationId, org), eq(tables.name, tableName)))).length, 1);
    const page = await readNativeExecutionOutput({ executionId: first.executionId, actor, limit: 500 });
    assert(page.terminal);assert(page.events.some(event => event.chunk.type === "tool-input-available"));
    assert.deepEqual(page.events.map(event => event.cursor), page.events.map((_event, index) => index + 1));
    await assert.rejects(readNativeExecutionOutput({ executionId: first.executionId, actor, expected: { ...first, threadId: randomUUID() } }), /不存在/);
    const earlyPage = await readNativeExecutionOutput({ executionId: first.executionId, actor, limit: 1 });assert.equal(earlyPage.terminal, false);
    await assert.rejects(readNativeExecutionOutput({ executionId: first.executionId, actor: { ...actor, userId: randomUUID() } }), /不存在/);
    // Duplicate transport delivery sees settled receipt and never enters the SDK.
    await launch(first.executionId);assert.equal(requests.length, 2);

    const answerLease = await claimRuntimeLease(thread.id, actor);
    const answerRecord = await prepareRuntimeRecord(answerLease, actor, { profileId, harness: "pi", mode: "local" });
    const resumed = await resumeQuestionRun(answerLease, actor, answerRecord, { intent: "tool-result", assistantMessageId: run.assistantMessageId,
      toolResults: [{ toolCallId: "question-1", output: answer }] });
    assert.equal(resumed.run.id, run.id);
    const second = await acceptNativeExecution({ actor, lease: answerLease, run: resumed.run, context: { page: "ai" }, prompt: "", toolResultContinuations: resumed.toolResultContinuations });
    assert.notEqual(second.executionId, first.executionId);
    const unauthorized = await fetch(`${endpoint}/start`, { method: "POST", body: JSON.stringify({ id: second.executionId, reference: { executionId: second.executionId } }) });
    assert.equal(unauthorized.status, 401);assert.equal(requests.length, 2);
    await launchViaHttp(second.executionId);
    await launchViaHttp(second.executionId);
    const complete = await loadNativeExecution(second.executionId);assert.equal(complete.run.status, "completed");
    assert.equal(requests.length, 3);
    const history = requests.at(-1)!.messages;
    assert.equal(history.filter(message => message.role === "user").length, 1);
    const results = history.filter(message => message.role === "tool" && message.tool_call_id === "question-1");assert.equal(results.length, 1);assert.deepEqual(JSON.parse(results[0].content as string), answer);
    assert.equal(history.filter(message => message.role === "tool" && message.tool_call_id === "table-1").length, 1);
    assert.equal((await db.select().from(tables).where(eq(tables.organizationId, org))).length, 1);
    const [cancelThread] = await db.insert(chatThreads).values({ userId: owner, organizationId: org, clientId: randomUUID(), custom: { resourceKey: "workspace", agentId: agentMember } }).returning();
    const cancelLease = await claimRuntimeLease(cancelThread.id, actor), cancelRecord = await prepareRuntimeRecord(cancelLease, actor, { profileId, harness: "pi", mode: "local" });
    const cancelRun = await beginNativeRun(cancelLease, actor, cancelRecord, { id: randomUUID(), parentId: null, format: "ai-sdk/v6", content: { role: "user", parts: [{ type: "text", text: "Cancelled before compute" }] } }, agentMember);
    const cancelled = await acceptNativeExecution({ actor, lease: cancelLease, run: cancelRun, context: { page: "ai" }, prompt: "Cancelled before compute" });
    await requestRunCancellation(cancelThread.id, cancelRun.id, actor);
    await launch(cancelled.executionId);assert.equal(requests.length, 3);
    assert.equal((await loadNativeExecution(cancelled.executionId)).run.status, "cancelled");
    const cancelOutput = await readNativeExecutionOutput({ executionId: cancelled.executionId, actor, limit: 500 });
    assert(cancelOutput.terminal);assert(cancelOutput.events.some(event => event.chunk.type === "abort"));
    assert(!JSON.stringify(cancelOutput.events).includes("系统提示"));
    // A crash after the durable invocation fence is unknown, never a retry cue.
    const [unknownThread] = await db.insert(chatThreads).values({ userId: owner, organizationId: org, clientId: randomUUID(), custom: { resourceKey: "workspace", agentId: agentMember } }).returning();
    const unknownLease = await claimRuntimeLease(unknownThread.id, actor), unknownRecord = await prepareRuntimeRecord(unknownLease, actor, { profileId, harness: "pi", mode: "local" });
    const unknownMessage = randomUUID();
    const unknownRun = await beginNativeRun(unknownLease, actor, unknownRecord, { id: unknownMessage, parentId: null, format: "ai-sdk/v6", content: { role: "user", parts: [{ type: "text", text: "Do not replay unknown start" }] } }, agentMember);
    const unknown = await acceptNativeExecution({ actor, lease: unknownLease, run: unknownRun, context: { page: "ai" }, prompt: "Do not replay unknown start" });
    assert(await claimNativeExecution(await loadNativeExecution(unknown.executionId)));
    await launch(unknown.executionId);assert.equal(requests.length, 3);
    assert.equal((await db.select().from(agentExecutions).where(eq(agentExecutions.id, unknown.executionId)))[0].status, "invoking");
    await releaseRuntimeLease(unknownLease);
    assert.equal((await db.select().from(agentRuns).where(eq(agentRuns.id, run.id))).length, 1);
  } finally {
    await remoteExecutor.close();await executor.close();controlServer.closeAllConnections();await new Promise<void>(done => controlServer.close(() => done()));provider.closeAllConnections();await new Promise<void>(done => provider.close(() => done()));
    await db.delete(organization).where(eq(organization.id, org));
    for (const id of [owner, agentUser]) await db.delete(user).where(eq(user.id, id));
    await nodeJobResources.database.close();
  }
}));
