import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { AskUserQuestionsInput, AskUserQuestionsOutput } from "@tabdo/shared";

if (!process.env.DATABASE_URL?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
for (const key of ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "PI_API_KEY", "PI_BASE_URL"]) process.env[key] = "";
const { db, client } = await import("../../src/db/index.js");
const { auth } = await import("../../src/auth/index.js");
const { chatRoute } = await import("../../src/routes/chat.js");
const { threadsRoute } = await import("../../src/routes/threads.js");
const { organization, member, session, user, agentProfile, agentRuns, agentRuntimeSessions, tables } = await import("../../src/db/schema.js");
const { validateQuestionAnswer } = await import("../../src/harness/questions.js");
const { resumeQuestionRun } = await import("../../src/harness/questions.js");
const { claimRuntimeLease, prepareRuntimeRecord } = await import("../../src/harness/store.js");
const { createNativeChatStream } = await import("../../src/harness/chat-stream.js");
const { hasQuestionSandbox, discardQuestionSandbox } = await import("../../src/harness/question-sandboxes.js");
const app = new Hono().route("/api/chat", chatRoute).route("/api/threads", threadsRoute);
app.onError((error, c) => "getResponse" in error && typeof error.getResponse === "function" ? error.getResponse() : c.json({ error: error.message }, error.name === "ZodError" ? 400 : 500));
const org = randomUUID(), agentUser = randomUUID(), agentMember = randomUUID(), profileId = randomUUID();
let owner = "", cookie = "";
const question: AskUserQuestionsInput = { allowPartialAnswers: false, questions: [{ id: "direction", question: "Which direction?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], allowMultiple: false, allowFreeForm: true }] };
const answer: AskUserQuestionsOutput = { action: "answered", answers: { direction: { optionIds: ["b"] } } };
const req = (path: string, body?: unknown) => app.request(`http://localhost:3001/api${path}`, { method: body ? "POST" : "GET", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
before(async () => {
  const response = await auth.handler(new Request("http://localhost:3001/api/auth/sign-up/email", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" }, body: JSON.stringify({ email: `questions-${randomUUID()}@local.test`, password: "Fixture-password-123!", name: "Question fixture" }) }));
  assert.equal(response.status, 200);owner = (await response.json()).user.id;
  cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  await db.insert(user).values({ id: agentUser, email: `${agentUser}@local.test`, name: "Question agent", kind: "agent" });
  await db.insert(organization).values({ id: org, name: "Question fixture", slug: org });
  await db.insert(member).values([{ id: randomUUID(), userId: owner, organizationId: org, role: "owner" }, { id: agentMember, userId: agentUser, organizationId: org }]);
  await db.insert(agentProfile).values({ id: profileId, userId: agentUser, organizationId: org, memberId: agentMember, displayName: "Question agent", persona: { defaultHarness: "pi", defaultModel: "local-test", runtime: "local", skillNames: [] } });
  await db.update(session).set({ activeOrganizationId: org }).where(eq(session.userId, owner));
});
after(async () => {
  await db.delete(organization).where(eq(organization.id, org));
  for (const id of [owner, agentUser]) await db.delete(user).where(eq(user.id, id));
  await client.end();
});

test("answers enforce the official schema and stored question option permissions", async () => {
  assert.deepEqual(await validateQuestionAnswer(question, answer), answer);
  assert.deepEqual(await validateQuestionAnswer(question, { action: "declined" }), { action: "declined" });
  const textOnly: AskUserQuestionsInput = { allowPartialAnswers: false, questions: [{ id: "text", question: "What should change?" }] };
  assert.deepEqual(await validateQuestionAnswer(textOnly, { action: "answered", answers: { text: { optionIds: [], freeform: "Keep the existing data" } } }), { action: "answered", answers: { text: { optionIds: [], freeform: "Keep the existing data" } } });
  await assert.rejects(validateQuestionAnswer({ ...textOnly, questions: [{ ...textOnly.questions[0], allowFreeForm: false }] }, { action: "answered", answers: { text: { optionIds: [], freeform: "Not permitted" } } }));
  for (const output of [
    { action: "answered", answers: { direction: { optionIds: ["forged"] } } },
    { action: "answered", answers: { direction: { optionIds: ["a", "b"] } } },
    { action: "answered", answers: {} },
    { action: "partially-answered", answers: { direction: { optionIds: ["a"] } } },
    { action: "answered", answers: { forged: { optionIds: ["a"] } } },
  ]) await assert.rejects(validateQuestionAnswer(question, output));
});

test("real Pi pending question reload and official tool result resume preserve one native turn and one data mutation", { timeout: 30000 }, async () => {
  const requests: { messages: { role: string; content: unknown; tool_call_id?: string }[] }[] = [];
  let forceQuestion = false;
  const provider = createServer(async (request, response) => {
    let raw = "";for await (const chunk of request) raw += chunk;requests.push(JSON.parse(raw));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "questions-fixture", object: "chat.completion.chunk", created: 1, model: "local-test", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    const call = requests.length === 1 ? { id: "mutation-1", name: "create_table", input: { name: `Question proof ${org}` } } : requests.length === 2 || forceQuestion ? { id: "question-1", name: "askUserQuestions", input: question } : undefined;
    if (call) { send({ role: "assistant", tool_calls: [{ index: 0, id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.input) } }] });send({}, "tool_calls"); }
    else { send({ role: "assistant", content: "Answer B received without replay." });send({}, "stop"); }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();assert(address && typeof address !== "string");
  process.env.PI_API_KEY = "fixture";process.env.PI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.PI_CONTEXT_WINDOW = "262144";process.env.PI_MAX_OUTPUT_TOKENS = "1024";
  try {
    const created = await req("/threads", { clientId: randomUUID(), context: { page: "ai" }, agentId: agentMember });assert.equal(created.status, 201);
    const threadId = (await created.json()).id, userMessageId = randomUUID();
    const base = { id: threadId, agentId: agentMember, context: { page: "ai" } };
    const first = await req("/chat", { ...base, messages: [{ id: userMessageId, role: "user", parts: [{ type: "text", text: "Create one table and ask my direction." }] }] });
    assert.equal(first.status, 200);assert.match(await first.text(), /askUserQuestions/);
    assert.equal(requests.length, 2);
    let runs = (await (await req(`/threads/${threadId}/runs`)).json()).runs;assert.equal(runs.length, 1);assert.equal(runs[0].status, "suspended");
    const runId = runs[0].id, assistantMessageId = runs[0].assistantMessageId;
    let history = await (await req(`/threads/${threadId}/messages`)).json();assert.equal(history.messages.length, 2);
    const pending = history.messages[1].content.parts.find((part: { toolCallId?: string }) => part.toolCallId === "question-1");
    assert.equal(pending.state, "input-available");assert.deepEqual(pending.input, question);
    const sendAnswer = (output: unknown, toolCallId = "question-1") => req("/chat", { ...base, intent: "tool-result", assistantMessageId, toolResults: [{ toolCallId, output }] });
    assert.equal((await sendAnswer(answer, "forged")).status, 400);
    assert.equal((await sendAnswer({ action: "answered", answers: { direction: { optionIds: ["forged"] } } })).status, 400);
    assert.equal((await req("/chat", { ...base, messages: [{ id: randomUUID(), role: "user", parts: [{ type: "text", text: "Do not lose this prompt" }] }] })).status, 409);
    assert.equal(requests.length, 2);
    const resumed = await sendAnswer(answer);assert.equal(resumed.status, 200);const resumedStream = await resumed.text();assert.match(resumedStream, /Answer B received without replay/);assert.match(resumedStream, /"type":"start-step"/);
    assert.equal(requests.length, 3);
    const nativeHistory = requests.at(-1)!.messages;
    assert.equal(nativeHistory.filter((message) => message.role === "user").length, 1);
    const outputs = nativeHistory.filter((message) => message.role === "tool" && message.tool_call_id === "question-1");assert.equal(outputs.length, 1);assert.deepEqual(JSON.parse(outputs[0].content as string), answer);
    runs = (await (await req(`/threads/${threadId}/runs`)).json()).runs;assert.equal(runs.length, 1);assert.equal(runs[0].id, runId);assert.equal(runs[0].status, "completed");
    history = await (await req(`/threads/${threadId}/messages`)).json();assert.equal(history.messages.length, 2);assert.equal(history.headId, assistantMessageId);
    const answered = history.messages[1].content.parts.find((part: { toolCallId?: string }) => part.toolCallId === "question-1");assert.deepEqual(answered.output, answer);
    assert.equal((await db.select().from(tables).where(and(eq(tables.organizationId, org), eq(tables.name, `Question proof ${org}`)))).length, 1);
    assert.equal((await sendAnswer(answer)).status, 409);assert.equal(requests.length, 3);
    const next = await req("/chat", { ...base, messages: [{ id: randomUUID(), role: "user", parts: [{ type: "text", text: "A fresh next question" }] }] });assert.equal(next.status, 200);const nextStream = await next.text();assert.match(nextStream, /Answer B received without replay/);
    assert.equal(requests.at(-1)!.messages.filter((message) => message.role === "user").length, 2, JSON.stringify(requests.at(-1)));
    const [runtime] = await db.select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.threadId, threadId));assert(runtime.resumeState);assert.equal(runtime.resumeState.continueFrom, undefined);
    assert.equal((await db.select().from(agentRuns).where(eq(agentRuns.threadId, threadId))).length, 2);

    // The resource map is an optimization, not a restore gate. Drop both the
    // native parked runtime and warm handle; the API restores its clean DB state.
    const restoredThread = (await (await req("/threads", { clientId: randomUUID(), context: { page: "ai" }, agentId: agentMember })).json()).id;
    forceQuestion = true;
    const restorePending = await req("/chat", { ...base, id: restoredThread, messages: [{ id: randomUUID(), role: "user", parts: [{ type: "text", text: "Ask before process replacement" }] }] });assert.equal(restorePending.status, 200);await restorePending.text();forceQuestion = false;
    const restoreRun = (await (await req(`/threads/${restoredThread}/runs`)).json()).runs[0];
    const [restoreRecord] = await db.select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.threadId, restoredThread));
    await discardQuestionSandbox(restoreRecord.id);assert(!hasQuestionSandbox(restoreRecord.id));
    const restoreCalls = requests.length;
    const restoredAnswer = await req("/chat", { ...base, id: restoredThread, intent: "tool-result", assistantMessageId: restoreRun.assistantMessageId, toolResults: [{ toolCallId: "question-1", output: answer }] });assert.equal(restoredAnswer.status, 200);assert.match(await restoredAnswer.text(), /Answer B received without replay/);
    assert.equal(requests.length, restoreCalls + 1);assert.equal(requests.at(-1)!.messages.filter((message) => message.role === "user").length, 1);

    // A configuration failure after the answer's atomic commit must not erase
    // its structure or certify the already-executed original turn as uninvoked.
    const failureThread = (await (await req("/threads", { clientId: randomUUID(), context: { page: "ai" }, agentId: agentMember })).json()).id;
    forceQuestion = true;
    const pendingResponse = await req("/chat", { ...base, id: failureThread, messages: [{ id: randomUUID(), role: "user", parts: [{ type: "text", text: "Ask a question" }] }] });assert.equal(pendingResponse.status, 200);await pendingResponse.text();forceQuestion = false;
    const failureRun = (await (await req(`/threads/${failureThread}/runs`)).json()).runs[0];
    const actor = { kind: "human" as const, userId: owner, organizationId: org, memberId: "owner", role: "owner", name: "Question fixture", email: "fixture@local.test" };
    const lease = await claimRuntimeLease(failureThread, actor), record = await prepareRuntimeRecord(lease, actor, { profileId, harness: "pi", mode: "local" });
    const accepted = await resumeQuestionRun(lease, actor, record, { intent: "tool-result", assistantMessageId: failureRun.assistantMessageId, toolResults: [{ toolCallId: "question-1", output: answer }] });
    const beforeFailureCalls = requests.length;
    process.env.PI_API_KEY = "";
    const reader = createNativeChatStream({ actor, lease, record, run: accepted.run, harness: "pi", modelId: "local-test", instructions: "Fixture", tools: {}, skills: [], prompt: "", messages: accepted.messages, toolResultContinuations: accepted.toolResultContinuations, metadata: {} }).getReader();
    const chunks = [];for (;;) { const item = await reader.read();if (item.done) break;chunks.push(item.value); }reader.releaseLock();
    assert.match(JSON.stringify(chunks), /Pi 未配置/);assert.equal(requests.length, beforeFailureCalls);
    const failedHistory = await (await req(`/threads/${failureThread}/messages`)).json();
    assert.equal(failedHistory.messages.length, 2);
    assert.deepEqual(failedHistory.messages[1].content.parts.find((part: { toolCallId?: string }) => part.toolCallId === "question-1").output, answer);
    assert(!JSON.stringify(failedHistory).includes("pi-not-invoked"));
    const [failedRuntime] = await db.select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.id, record.id));assert.deepEqual(failedRuntime.resumeState, record.resumeState);assert.deepEqual(failedRuntime.workspace, record.workspace);
    assert.equal((await (await req(`/threads/${failureThread}/runs`)).json()).runs[0].status, "failed");
    assert(hasQuestionSandbox(record.id));
    process.env.PI_API_KEY = "fixture";
    const stoppedLease = await claimRuntimeLease(failureThread, actor), stoppedRecord = await prepareRuntimeRecord(stoppedLease, actor, { profileId, harness: "pi", mode: "local" });
    const stoppedAnswer = await resumeQuestionRun(stoppedLease, actor, stoppedRecord, { intent: "tool-result", assistantMessageId: failureRun.assistantMessageId, toolResults: [{ toolCallId: "question-1", output: answer }] });
    const stoppedReader = createNativeChatStream({ actor, lease: stoppedLease, record: stoppedRecord, run: stoppedAnswer.run, harness: "pi", modelId: "local-test", instructions: "Fixture", tools: {}, skills: [], prompt: "", messages: stoppedAnswer.messages, toolResultContinuations: stoppedAnswer.toolResultContinuations, metadata: {}, signal: AbortSignal.abort(new DOMException("Early stop", "AbortError")) }).getReader();
    for (;;) { const item = await stoppedReader.read();if (item.done) break; }stoppedReader.releaseLock();
    assert.equal((await (await req(`/threads/${failureThread}/runs`)).json()).runs[0].status, "cancelled");assert.equal(requests.length, beforeFailureCalls);
    const retryAnswer = await req("/chat", { ...base, id: failureThread, intent: "tool-result", assistantMessageId: failureRun.assistantMessageId, toolResults: [{ toolCallId: "question-1", output: answer }] });assert.equal(retryAnswer.status, 200);assert.match(await retryAnswer.text(), /Answer B received without replay/);
    assert.equal(requests.length, beforeFailureCalls + 1);assert.equal(requests.at(-1)!.messages.filter((message) => message.role === "user").length, 1);
    const retriedRuns = (await (await req(`/threads/${failureThread}/runs`)).json()).runs;assert.equal(retriedRuns.length, 1);assert.equal(retriedRuns[0].id, failureRun.id);assert.equal(retriedRuns[0].status, "completed");
    assert.equal((await db.select().from(tables).where(and(eq(tables.organizationId, org), eq(tables.name, `Question proof ${org}`)))).length, 1);
    assert(!hasQuestionSandbox(record.id));
    // Explicit deletion of an unanswered native question discards its resource
    // without invoking the model, independent of the Run status label.
    forceQuestion = true;
    const deletePending = await req("/chat", { ...base, id: failureThread, messages: [{ id: randomUUID(), role: "user", parts: [{ type: "text", text: "Ask before deleting" }] }] });assert.equal(deletePending.status, 200);await deletePending.text();forceQuestion = false;
    const deleteCalls = requests.length;assert(hasQuestionSandbox(record.id));
    const deleted = await app.request(`http://localhost:3001/api/threads/${failureThread}`, { method: "DELETE", headers: { Cookie: cookie } });assert.equal(deleted.status, 200);assert(!hasQuestionSandbox(record.id));
    assert.equal(requests.length, deleteCalls);
  } finally {
    process.env.PI_API_KEY = "";process.env.PI_BASE_URL = "";
    delete process.env.PI_CONTEXT_WINDOW;delete process.env.PI_MAX_OUTPUT_TOKENS;
    provider.closeAllConnections();await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});
