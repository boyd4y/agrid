import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createServer } from "node:http";
import { after, before, test } from "../runtime.js";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { Actor } from "../../src/auth/actor.js";
import type { AskUserQuestionsInput } from "@tabdo/shared";
import type { BackgroundWakeup } from "../../src/business/background.js";
import { requirePlatformResources, withPlatformResources } from "../../src/resources/scope.js";

if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
for (const key of ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "PI_API_KEY", "PI_BASE_URL"]) process.env[key] = "";
const { db, client } = await import("../../src/db/index.js");
const { user, member, organization, userApiKeys, agentProfile, chatThreads, chatMessages, agentRuns, agentRuntimeSessions,
  automationRuns, automationEvents, automationOutbox, automationAgentActions, automationStepReceipts, automations, tables, rows } = await import("../../src/db/schema.js");
const { createTable, getTable, getRow, addRow } = await import("../../src/commands/index.js");
const { createAutomation } = await import("../../src/automation/crud.js");
const { claimExecution, executeNext, reconcileNativeAutomations } = await import("../../src/automation/execution.js");
const { runAutomationAgentAction } = await import("../../src/automation/agent-action.js");
const { claimRuntimeLease, prepareRuntimeRecord, releaseRuntimeLease, NOT_INVOKED } = await import("../../src/harness/store.js");
const { beginNativeRun } = await import("../../src/harness/runs.js");
const { createNativeChatStream } = await import("../../src/harness/chat-stream.js");
const { discardQuestionSandbox } = await import("../../src/harness/question-sandboxes.js");
const { chatRoute } = await import("../../src/routes/chat.js");
const { threadsRoute } = await import("../../src/routes/threads.js");
const { listScheduledRuns, getScheduledRunThread } = await import("../../src/automation/scheduled-runs.js");
const app = new Hono().route("/api/chat", chatRoute).route("/api/threads", threadsRoute);
app.onError((error, c) => "getResponse" in error && typeof error.getResponse === "function" ? error.getResponse() : c.json({ error: error.message }, 500));
const org = randomUUID(), owner = randomUUID(), ownerMember = randomUUID(), agentUser = randomUUID(), agentMember = randomUUID(), profileId = randomUUID();
const actor: Actor = { kind: "human", userId: owner, memberId: ownerMember, organizationId: org, role: "owner", name: "Automation owner", email: `${owner}@local.test` };
const apiKey = `tab_${randomBytes(32).toString("base64url")}`;
const runIds: string[] = [];
let sourceId: string, anchorId: string, ruleId: string, mutationName = "", blockFirst: (() => Promise<void>) | undefined;
let mutationInput: { rowId: string; columnId: string; value: string } | undefined;
type RequestBody = { messages: { role: string; content: unknown; tool_call_id?: string }[] };
const requests: RequestBody[] = [], providerErrors: unknown[] = [];
const question: AskUserQuestionsInput = { allowPartialAnswers: false, questions: [{ id: "direction", question: "Which direction?", options: [{ id: "approve", label: "Approve" }], allowFreeForm: false }] };
const provider = createServer(async (request, response) => {
  try {
    let raw = "";for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw) as RequestBody;requests.push(body);
    const associations = await db.select().from(automationAgentActions).where(inArray(automationAgentActions.runId, runIds));
    assert(associations.some(mapping => mapping.agentRunId), "native model starts only after its stable mapping and Run are committed");
    assert(!JSON.stringify(body.messages.filter(message => message.role === "system")).includes("EXTERNAL_EVENT_MARKER"), "external events never become system permissions");
    const gate = blockFirst;blockFirst = undefined;if (gate) await gate();
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "automation-native", object: "chat.completion.chunk", created: 1, model: "local-test", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    const asking = JSON.stringify(body.messages.filter(message => message.role === "user")).includes("ASK_DIRECTION");
    const mutateAndAsk = JSON.stringify(body.messages.filter(message => message.role === "user")).includes("MUTATE_AND_ASK_DIRECTION");
    const answered = body.messages.some(message => message.role === "tool" && message.tool_call_id === "native-question");
    const mutated = body.messages.some(message => message.role === "tool" && message.tool_call_id === "native-mutation");
    const call = mutateAndAsk && !mutated ? { id: "native-mutation", name: "update_cell", input: mutationInput }
      : asking && !answered ? { id: "native-question", name: "askUserQuestions", input: question }
      : !asking && !mutated ? { id: "native-mutation", name: "create_table", input: { name: mutationName } } : undefined;
    if (call) { send({ role: "assistant", tool_calls: [{ index: 0, id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.input) } }] });send({}, "tool_calls"); }
    else { send({ role: "assistant", content: asking ? "Native answer received." : "Native automation finished." });send({}, "stop"); }
    response.end("data: [DONE]\n\n");
  } catch (error) { providerErrors.push(error);response.writeHead(500);response.end("Fixture assertion failed"); }
});
before(async () => {
  await db.insert(user).values([{ id: owner, name: actor.name, email: actor.email }, { id: agentUser, name: "Native automation agent", email: `${agentUser}@local.test`, kind: "agent" }]);
  await db.insert(organization).values({ id: org, name: "Native automation actions", slug: org });
  await db.insert(member).values([{ id: ownerMember, userId: owner, organizationId: org, role: "owner" }, { id: agentMember, userId: agentUser, organizationId: org }]);
  await db.insert(userApiKeys).values({ userId: owner, organizationId: org, name: "Fixture", keyHash: createHash("sha256").update(apiKey).digest("hex"), prefix: "fixture" });
  await db.insert(agentProfile).values({ id: profileId, userId: agentUser, organizationId: org, memberId: agentMember, displayName: "Native automation agent", persona: { defaultHarness: "pi", defaultModel: "local-test", runtime: "local", skillNames: [] } });
  sourceId = (await createTable({ organizationId: org, name: "Event source" })).id;
  anchorId = (await addRow({ organizationId: org, tableId: sourceId, skipAutomation: true })).id;
  ruleId = (await db.insert(automations).values({ organizationId: org, createdByUserId: owner, source: { kind: "table", tableId: sourceId }, tableId: sourceId, name: "Native agent action", trigger: { type: "row_created" } }).returning())[0].id;
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();assert(address && typeof address !== "string");
  process.env.PI_API_KEY = "fixture";process.env.PI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.PI_CONTEXT_WINDOW = "262144";process.env.PI_MAX_OUTPUT_TOKENS = "1024";
});
after(async () => {
  const records = await db.select({ id: agentRuntimeSessions.id }).from(agentRuntimeSessions).innerJoin(chatThreads, eq(chatThreads.id, agentRuntimeSessions.threadId)).where(eq(chatThreads.organizationId, org));
  await Promise.all(records.map(record => discardQuestionSandbox(record.id)));
  provider.closeAllConnections();await new Promise<void>(resolve => provider.close(() => resolve()));
  await db.delete(automationRuns).where(inArray(automationRuns.id, runIds));
  await db.delete(automationEvents).where(eq(automationEvents.organizationId, org));
  await db.delete(organization).where(eq(organization.id, org));
  await db.delete(user).where(inArray(user.id, [owner, agentUser]));
  await client.end();
});
async function input(prompt: string) {
  const run = (await db.insert(automationRuns).values({ automationId: ruleId, tableId: sourceId, rowId: anchorId, triggerType: "row_created", status: "running" }).returning())[0];
  runIds.push(run.id);
  return { runId: run.id, step: 0, organizationId: org, actorUserId: owner, action: { type: "run_agent" as const, agentUserId: agentUser, prompt },
    eventContext: { source: "table", type: "row_created", row: { id: anchorId }, payload: "EXTERNAL_EVENT_MARKER" }, tableId: sourceId };
}
const mappings = (runId: string) => db.select().from(automationAgentActions).where(eq(automationAgentActions.runId, runId));

test("headless native Pi commits one actual tool and reply; concurrent and receipt retries reuse its private turn", { timeout: 30000 }, async () => {
  const task = await input("Create one table for {{event.row.id}} then report the result.");
  mutationName = `Automation mutation ${randomUUID()}`;
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), reached = new Promise<void>(resolve => { started = resolve; });
  blockFirst = async () => { started();await gate; };
  const executing = runAutomationAgentAction(task);
  await reached;
  let duplicate;
  try { duplicate = await runAutomationAgentAction(task);assert.equal(duplicate.status, "accepted", "durably accepted computing work is distinct from an unknown invocation"); }
  finally { release(); }
  const result = await executing;
  assert.equal(result.status, "completed", result.error);assert.match(result.text, /Native automation finished/);
  assert.equal(result.threadId, duplicate.threadId);assert.equal(result.agentRunId, duplicate.agentRunId);
  const [mapping] = await mappings(task.runId);
  assert.equal(mapping.threadId, result.threadId);assert.equal(mapping.agentRunId, result.agentRunId);
  const [thread] = await db.select().from(chatThreads).where(eq(chatThreads.id, mapping.threadId));
  assert.equal(thread.userId, owner);assert.equal(thread.organizationId, org);assert.equal(thread.custom.resourceKey, "workspace");
  const history = await db.select().from(chatMessages).where(eq(chatMessages.threadId, mapping.threadId));
  assert.equal(history.length, 2);assert(history.some(message => message.serverFinal && message.content.role === "assistant"));
  assert.equal(requests.length, 2);assert.equal(requests.at(-1)!.messages.filter(message => message.role === "user").length, 1);
  assert.equal((await db.select().from(tables).where(and(eq(tables.organizationId, org), eq(tables.name, mutationName)))).length, 1);
  await db.insert(automationStepReceipts).values({ runId: task.runId, step: task.step, result: { ...result } });
  assert.deepEqual(await runAutomationAgentAction(task), result);assert.equal(requests.length, 2);
  assert.equal((await db.select().from(agentRuns).where(eq(agentRuns.threadId, mapping.threadId))).length, 1);
  assert.deepEqual(providerErrors, []);
});

test("native questions remain in the associated private chat and resume through the official chat tool-result endpoint", { timeout: 30000 }, async () => {
  const wakeups: BackgroundWakeup[] = [];
  const notificationScope = { ...requirePlatformResources(), background: { notify(wakeup: BackgroundWakeup) { wakeups.push(wakeup); } } };
  await withPlatformResources(notificationScope, async () => {
  const task = await input("ASK_DIRECTION before proceeding.");
  const initialCalls = requests.length, waiting = await runAutomationAgentAction(task);
  assert.equal(waiting.status, "waiting-input", waiting.error);assert(waiting.threadId && waiting.agentRunId);
  assert(wakeups.some(wakeup => wakeup.kind === "native-actions" && wakeup.threadId === waiting.threadId), "a committed native question requests scoped reconciliation");
  wakeups.length = 0;
  assert.equal(requests.length, initialCalls + 1);
  assert.deepEqual(await runAutomationAgentAction(task), waiting);assert.equal(requests.length, initialCalls + 1);
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, waiting.agentRunId));
  const answer = { action: "answered", answers: { direction: { optionIds: ["approve"] } } };
  const response = await app.request("http://localhost:3001/api/chat", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ intent: "tool-result", id: waiting.threadId, agentId: agentMember,
    context: { page: "ai" }, assistantMessageId: run.assistantMessageId, toolResults: [{ toolCallId: "native-question", output: answer }] }) });
  assert.equal(response.status, 200, await response.clone().text());assert.match(await response.text(), /Native answer received/);
  assert(wakeups.some(wakeup => wakeup.kind === "native-actions" && wakeup.threadId === waiting.threadId), "HTTP continuation wakes reconciliation after the canonical result commits");
  assert.equal(requests.length, initialCalls + 2);
  assert.equal(requests.at(-1)!.messages.filter(message => message.role === "user").length, 1, "answer continuation does not resend the triggering event/user prompt");
  assert.equal(requests.at(-1)!.messages.filter(message => message.tool_call_id === "native-question").length, 1);
  const completed = await runAutomationAgentAction(task);assert.equal(completed.status, "completed");assert.equal(completed.agentRunId, waiting.agentRunId);
  assert.match(completed.text, /Native answer received/);assert.equal(requests.length, initialCalls + 2);
  assert.deepEqual(providerErrors, []);
  });
});

test("a real server-certified Pi pre-invocation failure retries the stable Run; an unknown accepted turn never replays", { timeout: 30000 }, async () => {
  const task = await input("Retry only this task, never a previous native turn.");
  const initialCalls = requests.length;
  process.env.PI_API_KEY = "";
  const preflight = await runAutomationAgentAction(task);assert.equal(preflight.status, "failed");assert(preflight.threadId);assert.equal(preflight.agentRunId, null);
  const [mapping] = await mappings(task.runId);
  const lease = await claimRuntimeLease(mapping.threadId, actor), record = await prepareRuntimeRecord(lease, actor, { profileId, harness: "pi", mode: "local" });
  const message = { id: mapping.userMessageId, role: "user" as const, parts: [{ type: "text" as const, text: "Stable original input after genuine startup failure" }] };
  const run = await beginNativeRun(lease, actor, record, { id: message.id, parentId: null, format: "ai-sdk/v6", content: { role: message.role, parts: message.parts } }, agentMember);
  const reader = createNativeChatStream({ actor, lease, record, run, harness: "pi", modelId: "local-test", instructions: "Fixture", tools: {}, skills: [], prompt: message.parts[0].text, messages: [message], metadata: {} }).getReader();
  try { for (;;) { const part = await reader.read();if (part.done) break; } } finally { reader.releaseLock(); }
  const [reply] = await db.select().from(chatMessages).where(and(eq(chatMessages.threadId, mapping.threadId), eq(chatMessages.messageId, run.assistantMessageId)));
  assert.equal((reply.content.metadata as { nativeInvocation: string }).nativeInvocation, NOT_INVOKED);assert(reply.serverFinal);assert.equal(requests.length, initialCalls);
  process.env.PI_API_KEY = "fixture";mutationName = `Retried native mutation ${randomUUID()}`;
  const retried = await runAutomationAgentAction(task);assert.equal(retried.status, "completed", retried.error);
  assert.equal(retried.threadId, mapping.threadId);assert.equal(retried.agentRunId, run.id);
  assert.equal((await mappings(task.runId))[0].userMessageId, message.id);
  assert.equal((await db.select().from(agentRuns).where(eq(agentRuns.threadId, mapping.threadId))).length, 1);
  assert.equal(requests.at(-1)!.messages.filter(message => message.role === "user").length, 1);
  assert.match(JSON.stringify(requests.at(-1)!.messages), /Stable original input after genuine startup failure/);
  const afterRetry = requests.length;await runAutomationAgentAction(task);assert.equal(requests.length, afterRetry);

  const interrupted = await input("Unknown accepted turn");process.env.PI_API_KEY = "";
  await runAutomationAgentAction(interrupted);const [unknownMapping] = await mappings(interrupted.runId);
  const unknownLease = await claimRuntimeLease(unknownMapping.threadId, actor), unknownRecord = await prepareRuntimeRecord(unknownLease, actor, { profileId, harness: "pi", mode: "local" });
  await beginNativeRun(unknownLease, actor, unknownRecord, { id: unknownMapping.userMessageId, parentId: null, format: "ai-sdk/v6", content: { role: "user", parts: [{ type: "text", text: "Unknown accepted turn" }] } }, agentMember);
  await releaseRuntimeLease(unknownLease);process.env.PI_API_KEY = "fixture";
  assert.equal((await runAutomationAgentAction(interrupted)).status, "unknown");assert.equal(requests.length, afterRetry);
  assert.deepEqual(providerErrors, []);
});

test("native automation mutates its trigger row, parks a real question, then reconciles the same Run and commits remaining actions", { timeout: 30000 }, async () => {
  const source = await createTable({ organizationId: org, name: "Native executor source" });
  const sourceTitle = (await getTable({ organizationId: org, tableId: source.id })).columns[0].id;
  const target = await createTable({ organizationId: org, name: "Native executor destination" });
  const targetTitle = (await getTable({ organizationId: org, tableId: target.id })).columns[0].id;
  const rule = await createAutomation({ organizationId: org, actorId: owner, tableId: source.id, name: "Native followed by data", trigger: { type: "row_created" }, actions: [
    { type: "run_agent", agentUserId: agentUser, prompt: "MUTATE_AND_ASK_DIRECTION then finish the answer." },
    { type: "update_field", columnId: sourceTitle, value: "After native reply" },
    { type: "command", command: "addRow", input: { tableId: target.id, cells: { [targetTitle]: { $step: { index: 0, path: "text" } } } } },
  ] });
  const sourceRow = await addRow({ organizationId: org, actorId: owner, tableId: source.id });
  const [event] = await db.select().from(automationEvents).where(and(eq(automationEvents.organizationId, org), eq(automationEvents.rowId, sourceRow.id)));
  assert(event);
  const [automationRun] = await db.select().from(automationRuns).where(and(eq(automationRuns.eventId, event.id), eq(automationRuns.automationId, rule.id)));
  assert(automationRun);runIds.push(automationRun.id);
  mutationInput = { rowId: sourceRow.id, columnId: sourceTitle, value: "Native changed trigger row" };
  const initialCalls = requests.length, fence = await claimExecution(event.id, event.generation);assert(fence !== undefined);
  assert.equal(await executeNext(event.id, fence), "continue");
  const [parked] = await db.select().from(automationRuns).where(eq(automationRuns.id, automationRun.id));
  assert.equal(parked.status, "waiting_input", parked.error ?? "");assert.equal(parked.nextStep, 0);assert.equal(parked.finishedAt, null);
  assert.equal((await getRow({ organizationId: org, rowId: sourceRow.id })).version, 2, "the native tool actually mutated the trigger row once");
  assert.equal(requests.length, initialCalls + 2);
  assert.equal(await executeNext(event.id, fence), "done");
  assert.equal((await db.select().from(automationEvents).where(eq(automationEvents.id, event.id)))[0].status, "waiting_input");
  assert.equal((await db.select().from(automationOutbox).where(eq(automationOutbox.eventId, event.id)))[0].status, "done");
  const [mapping] = await mappings(automationRun.id);assert(mapping.agentRunId);
  const [nativeRun] = await db.select().from(agentRuns).where(eq(agentRuns.id, mapping.agentRunId));
  const response = await app.request("http://localhost:3001/api/chat", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ intent: "tool-result", id: mapping.threadId, agentId: agentMember,
    context: { page: "ai" }, assistantMessageId: nativeRun.assistantMessageId, toolResults: [{ toolCallId: "native-question", output: { action: "answered", answers: { direction: { optionIds: ["approve"] } } } }] }) });
  assert.equal(response.status, 200, await response.clone().text());assert.match(await response.text(), /Native answer received/);
  assert.equal(requests.length, initialCalls + 3);
  assert.equal(requests.at(-1)!.messages.filter(message => message.role === "user").length, 1);
  assert.equal(requests.at(-1)!.messages.filter(message => message.tool_call_id === "native-mutation").length, 1);
  assert.equal(await reconcileNativeAutomations(25, randomUUID()), 0);
  assert.equal(await reconcileNativeAutomations(25, org), 1);
  const [requeued] = await db.select().from(automationEvents).where(eq(automationEvents.id, event.id));assert.equal(requeued.generation, 1);
  const nextFence = await claimExecution(event.id, requeued.generation);assert(nextFence !== undefined);
  assert.equal(await executeNext(event.id, nextFence), "continue");
  assert.equal((await db.select().from(automationEvents).where(eq(automationEvents.id, event.id)))[0].expectedVersion, 2, "native completion adopts the actual row version before later data writes");
  assert.equal(await executeNext(event.id, nextFence), "continue");
  assert.equal(await executeNext(event.id, nextFence), "continue");
  assert.equal(await executeNext(event.id, nextFence), "done");
  const [finished] = await db.select().from(automationRuns).where(eq(automationRuns.id, automationRun.id));assert.equal(finished.status, "completed");assert.equal(finished.nextStep, 3);
  assert.deepEqual(await mappings(automationRun.id), [mapping], "question continuation and executor reconciliation preserve every association ID");
  assert.equal((await db.select().from(agentRuns).where(eq(agentRuns.threadId, mapping.threadId))).length, 1);
  assert.equal(requests.length, initialCalls + 3, "reconciliation never restarts the native model or its completed tools");
  const actualSource = await getRow({ organizationId: org, rowId: sourceRow.id });assert.equal(actualSource.version, 3);assert.equal(actualSource.cells[sourceTitle], "After native reply");
  const savedTargets = await db.select().from(rows).where(eq(rows.tableId, target.id));assert.equal(savedTargets.length, 1);assert.match(String(savedTargets[0].cells[targetTitle]), /Native answer received/);
  assert.equal((await db.select().from(automationStepReceipts).where(eq(automationStepReceipts.runId, automationRun.id))).length, 3);
  assert.equal(await reconcileNativeAutomations(25, org), 0);assert.equal(await executeNext(event.id, nextFence), "done");assert.equal(requests.length, initialCalls + 3);
  assert.deepEqual(providerErrors, []);mutationInput = undefined;
});


test("scheduled occurrences are separate session types, private and continuable through the same native runtime", { timeout: 30000 }, async () => {
  const action = { type: "run_agent" as const, agentUserId: agentUser, prompt: "Summarize a scheduled task." };
  const rule = await createAutomation({ organizationId: org, actorId: owner, name: "Scheduled session proof", source: { kind: "schedule", cron: "0 9 * * *", timeZone: "UTC" }, trigger: { type: "schedule_due" }, actions: [action] });
  const saved = (await db.insert(automationRuns).values({ automationId: rule.id, triggerType: "schedule_due", status: "running", ruleSnapshot: rule as unknown as Record<string, unknown> }).returning())[0];
  runIds.push(saved.id); mutationName = `Scheduled native mutation ${randomUUID()}`;
  const result = await runAutomationAgentAction({ runId: saved.id, step: 0, organizationId: org, actorUserId: owner, action, eventContext: { scheduledFor: new Date().toISOString() }, tableId: null });
  assert.equal(result.status, "completed", result.error); assert(result.threadId);
  const [thread] = await db.select().from(chatThreads).where(eq(chatThreads.id, result.threadId));
  assert.equal(thread.kind, "scheduled_task"); assert.equal(thread.scheduledTaskId, rule.id); assert.equal(thread.custom.resourceKey, `schedule:${rule.id}`);
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  const ordinary = await (await app.request("http://localhost/api/threads", { headers })).json();
  assert(!ordinary.threads.some((item: { id: string }) => item.id === thread.id));
  assert.equal((await app.request(`http://localhost/api/threads?after=${thread.id}`, { headers })).status, 400);
  const card = (await listScheduledRuns(rule.id, actor)).runs[0];
  assert.equal(card.threadId, thread.id); assert.match(card.preview ?? "", /Native automation finished/); assert.equal(card.prompt, action.prompt);
  assert.equal((await listScheduledRuns(rule.id, { ...actor, userId: agentUser })).runs.length, 0);
  assert.equal((await getScheduledRunThread(rule.id, thread.id, actor)).id, thread.id);
  await assert.rejects(getScheduledRunThread(rule.id, thread.id, { ...actor, userId: agentUser }));
  await assert.rejects(getScheduledRunThread(ruleId, thread.id, actor));
  assert.equal((await app.request(`http://localhost/api/threads/${thread.id}`, { method: "PATCH", headers, body: JSON.stringify({ custom: { agentId: owner } }) })).status, 409);
  assert.equal((await app.request("http://localhost/api/threads", { method: "POST", headers, body: JSON.stringify({ clientId: randomUUID(), context: { page: "schedules", scheduledTaskId: rule.id }, agentId: agentMember }) })).status, 400);
  const [runtimeBefore] = await db.select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.threadId, thread.id));
  const before = requests.length;
  const followUp = await app.request("http://localhost/api/chat", { method: "POST", headers, body: JSON.stringify({ id: thread.id, agentId: agentMember,
    context: { page: "schedules", scheduledTaskId: rule.id }, messages: [{ id: randomUUID(), role: "user", parts: [{ type: "text", text: "Continue this scheduled result." }] }] }) });
  assert.equal(followUp.status, 200, await followUp.clone().text()); assert.match(await followUp.text(), /Native automation finished/);
  assert.equal(requests.length, before + 1, "continuation does not repeat the accepted mutation");
  const records = await db.select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.threadId, thread.id));
  assert.equal(records.length, 1); assert.equal(records[0].id, runtimeBefore.id);
  const messages = await db.select().from(chatMessages).where(eq(chatMessages.threadId, thread.id));
  assert.equal(messages.filter(message => message.content.role === "user").length, 2);
  assert.equal((await db.select().from(tables).where(and(eq(tables.organizationId, org), eq(tables.name, mutationName)))).length, 1);
  assert.equal((await db.select().from(chatThreads).where(eq(chatThreads.id, thread.id)))[0].kind, "scheduled_task");
  const extra = (await db.insert(automationRuns).values({ automationId: rule.id, triggerType: "schedule_due", status: "queued", ruleSnapshot: rule as unknown as Record<string, unknown> }).returning())[0];
  runIds.push(extra.id);
  const pageOne = await listScheduledRuns(rule.id, actor, 0, 1), pageTwo = await listScheduledRuns(rule.id, actor, 1, 1);
  assert(pageOne.hasMore); assert(!pageTwo.hasMore); assert.equal(pageOne.runs.length, 1); assert.equal(pageTwo.runs.length, 1);
  assert.notEqual(pageOne.runs[0].id, pageTwo.runs[0].id);
  assert.deepEqual(providerErrors, []);
});
