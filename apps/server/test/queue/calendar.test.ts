import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { before, after, test } from "../runtime.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, client } from "../../src/db/index.js";
import { organization, user, member, agentProfile, workspaces, tables, bookings, bookingReminderIntents, bookingReminders,
  automations, automationEvents, automationRuns, automationOutbox, automationAgentActions, agentRuns, agentRuntimeSessions, chatThreads } from "../../src/db/schema.js";
import { executeCalendar } from "../../src/business/calendar/service.js";
import { dispatchDueBookingReminders } from "../../src/business/calendar/reminders.js";
import { nextScheduleDeadline } from "../../src/business/automation/deadlines.js";
import { commandDependencies, runtimeDependencies } from "../../src/services/dependencies.js";
import { createAutomationQueue } from "../../src/automation/jobs/queues.js";
import { createRelay } from "../../src/automation/jobs/relay.js";
import { createAutomationService } from "../../src/automation/jobs/service.js";
import { createPublishedReconciler } from "../../src/automation/jobs/reconcile.js";
import { createRedisClient, waitForRedisReady } from "@tabdo/queue/redis";
import { redisOptions } from "../../src/automation/jobs/config.js";
import { runAutomationAgentAction } from "../../src/business/automation/agent-action.js";
import { prepareNativeChatAgent } from "../../src/harness/preparation.js";
import { discardQuestionSandbox } from "../../src/harness/question-sandboxes.js";
import { createSiteKey, updateSiteKey, deleteSiteKey } from "../../src/business/data-api/keys.js";
import type { Actor } from "../../src/business/auth/actor.js";
import { createTableTools } from "../../src/business/agent/tools/index.js";
import { Hono } from "hono";
import { createAutomationsRoute } from "../../src/business/http/automations.js";
import { requireThread } from "../../src/business/chat/store.js";
import type { AutomationRule, BookingReminder, CalendarCommand, CalendarCommands } from "@tabdo/shared";
assert(new URL(process.env.DATABASE_URL!).pathname.endsWith("_queue_test")); assert.equal(process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED);
assert.equal(new URL(process.env.REDIS_URL!).port, "16381"); assert(process.env.QUEUE_PREFIX?.startsWith("agrid-queue-test-0045"));
for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CODEX_API_KEY", "CLAUDE_API_KEY", "PI_API_KEY", "PI_BASE_URL"]) process.env[name] = "";
const org = randomUUID(), uid = randomUUID(), aid = randomUUID(), am = randomUUID(), peerId = randomUUID();
let workspaceId: string, otherWorkspaceId: string, calendarId: string, marker = "";
const caller = { kind: "member" as const, organizationId: org, actorId: uid };
const children: ChildProcess[] = [], failures: unknown[] = [];
let service: ReturnType<typeof createAutomationService> | undefined;
let modelCalls = 0;
const provider = createServer(async (request, response) => {
  try {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw) as { messages: { role: string; content: unknown; tool_call_id?: string }[] };
    modelCalls++;
    assert(await db.select().from(automationAgentActions).where(inArray(automationAgentActions.threadId, (await db.select({ id: chatThreads.id }).from(chatThreads).where(eq(chatThreads.organizationId, org))).map(v => v.id))).then(v => v.some(v => !!v.agentRunId)));
    const prompt = JSON.stringify(body.messages.filter(v => v.role === "user"));
    const token = prompt.match(/MUTATION_TABLE:([a-z0-9-]+)/)?.[1]; assert(token);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "calendar-fixture", object: "chat.completion.chunk", created: 1, model: "local-test", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (!body.messages.some(v => v.role === "tool" && v.tool_call_id === `call-${token}`)) {
      send({ role: "assistant", tool_calls: [{ index: 0, id: `call-${token}`, type: "function", function: { name: "create_table", arguments: JSON.stringify({ name: token }) } }] }); send({}, "tool_calls");
    } else { send({ role: "assistant", content: "Calendar reminder completed." }); send({}, "stop"); }
    response.end("data: [DONE]\n\n");
  } catch (error) { failures.push(error); response.writeHead(500); response.end("Fixture failure"); }
});
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function eventually(check: () => Promise<boolean>, timeout = 25000) { const start = Date.now(); while (!await check()) { if (Date.now() - start > timeout) throw new Error("Calendar worker timed out"); await wait(30); } }
const call = <K extends CalendarCommand>(name: K, input: CalendarCommands[K]) => executeCalendar({ ...commandDependencies(), workspaceId }, caller, name, input);
const queue = createAutomationQueue();
const redis = createRedisClient(redisOptions(false), { name: "calendar-queue-tests" });
let relay: ReturnType<typeof createRelay>;
async function fixture(kind: BookingReminder["kind"] = "at_end", minutesAgo = 1, beforeStartInMinutes = 20) {
  marker = `reminder-${randomUUID()}`;
  const personId = (await call("createCalendarPerson", { calendarId, name: marker, timeZone: "UTC", idempotencyKey: randomUUID() })).id;
  await call("setWorkingHours", { calendarId, personId, expectedVersion: 1, windows: [1,2,3,4,5,6,7].map(day => ({ day, start: "00:00", end: "24:00" })), idempotencyKey: randomUUID() });
  const minute = Math.floor(Date.now() / 60000) * 60000;
  const start = kind === "at_end" ? minute - (minutesAgo + 30) * 60000 : minute + beforeStartInMinutes * 60000;
  const end = start + 30 * 60000;
  const booking = await call("createBooking", { calendarId, personId, title: marker, time: { start: new Date(start).toISOString(), end: new Date(end).toISOString(), timeZone: "UTC" }, idempotencyKey: randomUUID() });
  const reminder: BookingReminder = { kind, offsetMinutes: kind === "at_end" ? 0 : 30, agentUserId: aid, prompt: `Create one table. MUTATION_TABLE:${marker}`, maxLatenessMinutes: 60 };
  const receipt = await call("setBookingReminders", { calendarId, bookingId: booking.id, expectedVersion: 1, reminders: [reminder], idempotencyKey: randomUUID() });
  return { booking: { ...booking, ...receipt }, marker, start, end, reminder };
}
async function due(id: string) {
  await dispatchDueBookingReminders({ ...commandDependencies(), workspaceId });
  return (await db.select().from(bookingReminderIntents).where(and(eq(bookingReminderIntents.bookingId, id), eq(bookingReminderIntents.status, "queued"))))[0];
}
async function startChild(eventId?: string, phase?: "BEFORE" | "AFTER") {
  const child = spawn(process.execPath, ["--import", "tsx", "test/queue/calendar-worker.ts"], { env: { ...process.env, FAULT_EVENT_ID: eventId ?? "", FAULT_PHASE: phase ?? "", AUTOMATION_LEASE_MS: "1000", WORKER_LOCK_MS: "1000", WORKER_STALLED_MS: "1000" }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child); let output = "";
  child.stdout!.on("data", chunk => { output += chunk; process.stdout.write(chunk); }); child.stderr!.on("data", chunk => { output += chunk; process.stderr.write(chunk); });
  await eventually(async () => { assert.equal(child.exitCode, null, output); return output.includes("CALENDAR_WORKER_READY"); });
  return { child, output: () => output };
}
async function stop(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM") { if (child.exitCode !== null || child.signalCode) return; const exit = new Promise(resolve => child.once("exit", resolve)); child.kill(signal); await exit; }
async function status(eventId: string) { return (await db.select().from(automationEvents).where(eq(automationEvents.id, eventId)))[0]; }
const count = (name: string, space = workspaceId) => db.select().from(tables).where(and(eq(tables.workspaceId, space), eq(tables.name, name))).then(v => v.length);
before(async () => {
  await db.insert(organization).values({ id: org, name: "Calendar queue", slug: org });
  await db.insert(user).values([{ id: uid, name: "Owner", email: `${uid}@local.test` }, { id: aid, name: "Agent", email: `${aid}@local.test`, kind: "agent" }, { id: peerId, name: "Other member", email: `${peerId}@local.test` }]);
  await db.insert(member).values([{ id: randomUUID(), userId: uid, organizationId: org, role: "owner" }, { id: am, userId: aid, organizationId: org, role: "member" }, { id: randomUUID(), userId: peerId, organizationId: org, role: "member" }]);
  await db.insert(agentProfile).values({ id: randomUUID(), organizationId: org, memberId: am, userId: aid, displayName: "Reminder agent", persona: { defaultHarness: "pi", defaultModel: "local-test", runtime: "local", skillNames: [] } });
  const [first] = await db.select().from(workspaces).where(eq(workspaces.organizationId, org)); workspaceId = first.id;
  otherWorkspaceId = (await db.insert(workspaces).values({ organizationId: org, name: "Foreground switched" }).returning())[0].id;
  calendarId = (await call("createCalendar", { name: "Queue clinic", timeZone: "UTC", idempotencyKey: randomUUID() })).id;
  relay = createRelay(queue);
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve)); const address = provider.address(); assert(address && typeof address !== "string");
  process.env.PI_API_KEY = "local-fixture"; process.env.PI_BASE_URL = `http://127.0.0.1:${address.port}/v1`; process.env.PI_CONTEXT_WINDOW = "262144"; process.env.PI_MAX_OUTPUT_TOKENS = "1024";
});
after(async () => {
  await service?.close(); for (const child of children) await stop(child, "SIGKILL");
  const sessions = await db.select({ id: agentRuntimeSessions.id }).from(agentRuntimeSessions).innerJoin(chatThreads, eq(chatThreads.id, agentRuntimeSessions.threadId)).where(eq(chatThreads.organizationId, org));
  await Promise.all(sessions.map(v => discardQuestionSandbox(v.id)));
  provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve()));
  await db.delete(automationEvents).where(eq(automationEvents.organizationId, org)); await db.delete(organization).where(eq(organization.id, org)); await db.delete(user).where(inArray(user.id, [uid, aid, peerId]));
  try { await relay?.close(); await queue.close(); await waitForRedisReady(redis); const keys = await redis.keys(`${process.env.QUEUE_PREFIX}:*`); if (keys.length) await redis.del(...keys); }
  finally { redis.disconnect(); await client.end(); }
});
test("real BullMQ + official native agent executes once after duplicate/reordered delivery in the original workspace", { timeout: 60000 }, async () => {
  const f = await fixture(); const intent = await due(f.booking.id); assert(intent.eventId);
  assert((await executeCalendar({ ...commandDependencies(), workspaceId: otherWorkspaceId }, caller, "listCalendars", {})).complete);
  const worker = await startChild();
  try {
    await relay.tick(); await queue.publish({ id: randomUUID(), body: { protocol: 2, eventId: intent.eventId, generation: 0 } });
    await eventually(async () => (await status(intent.eventId!)).finishedAt !== null);
    assert.equal(await count(f.marker), 1); assert.equal(await count(f.marker, otherWorkspaceId), 0);
    const [run] = await db.select().from(automationRuns).where(eq(automationRuns.eventId, intent.eventId)); assert.equal(run.status, "completed"); assert.equal(run.workspaceId, workspaceId);
    const mapping = await db.select().from(automationAgentActions).where(eq(automationAgentActions.runId, run.id)); assert.equal(mapping.length, 1); assert(mapping[0].agentRunId);
    await queue.publish({ id: randomUUID(), body: { protocol: 2, eventId: intent.eventId, generation: 0 } }); await wait(300); assert.equal(await count(f.marker), 1);
    const history = await call("listBookingReminders", { calendarId, bookingId: f.booking.id }); assert.equal(history.intents[0].status, "completed"); assert(history.intents[0].acceptedAt); assert(history.intents[0].threadId);
    console.log("CALENDAR_SINGLE_EFFECT", JSON.stringify({ eventId: intent.eventId, agentRunId: mapping[0].agentRunId, workspaceId, tables: 1 }));
  } finally { await stop(worker.child); }
});
test("cancel/reschedule committed while a real worker holds an old message invalidates actual native acceptance", { timeout: 60000 }, async () => {
  for (const kind of ["cancel", "reschedule"] as const) {
    const f = await fixture(); const intent = await due(f.booking.id); assert(intent.eventId);
    const worker = await startChild(intent.eventId, "BEFORE");
    try {
      await relay.tick(); await eventually(async () => worker.output().includes("CALENDAR_FAULT_BEFORE"));
      if (kind === "cancel") await call("cancelBooking", { calendarId, bookingId: f.booking.id, expectedVersion: 2, idempotencyKey: randomUUID() });
      else await call("rescheduleBooking", { calendarId, bookingId: f.booking.id, expectedVersion: 2, time: { start: new Date(f.start + 86400000).toISOString(), end: new Date(f.end + 86400000).toISOString(), timeZone: "UTC" }, idempotencyKey: randomUUID() });
      await stop(worker.child, "SIGKILL"); const replacement = await startChild();
      try { await eventually(async () => !!(await status(intent.eventId!)).finishedAt); assert.equal(await count(f.marker), 0); const [run] = await db.select().from(automationRuns).where(eq(automationRuns.eventId, intent.eventId)); assert.equal(run.status, "superseded"); const map = await db.select().from(automationAgentActions).where(eq(automationAgentActions.runId, run.id)); assert(map.every(v => !v.agentRunId)); }
      finally { await stop(replacement.child); }
    } finally { await stop(worker.child, "SIGKILL"); }
  }
});
test("durable acceptance survives lost dispatch/restart; cancellation after acceptance remains visible and does not create a second run", { timeout: 60000 }, async () => {
  const f = await fixture(); const intent = await due(f.booking.id); assert(intent.eventId);
  const [run] = await db.select().from(automationRuns).where(eq(automationRuns.eventId, intent.eventId)); const rule = run.ruleSnapshot as unknown as AutomationRule; const action = rule.actions[0]; assert.equal(action.type, "run_agent"); if (action.type !== "run_agent") return;
  const result = await runAutomationAgentAction({ ...runtimeDependencies(), agent: {
    async prepare(options) { return { ...await prepareNativeChatAgent(options), tableId: options.boundTableId }; },
    async dispatch() { throw new Error("FAULT_CONNECTION_LOST_AFTER_ACCEPTANCE"); },
  } }, { runId: run.id, step: 0, organizationId: org, actorUserId: uid, action, eventContext: { booking: { title: f.marker } }, tableId: null });
  assert.equal(result.status, "accepted"); assert(result.agentRunId); assert.equal(await count(f.marker), 0);
  await call("cancelBooking", { calendarId, bookingId: f.booking.id, expectedVersion: 2, idempotencyKey: randomUUID() });
  const history = await call("listBookingReminders", { calendarId, bookingId: f.booking.id }); assert.equal(history.intents[0].status, "accepted"); assert(history.intents[0].acceptedAt);
  const worker = await startChild();
  try { await relay.tick(); await eventually(async () => !!(await status(intent.eventId!)).finishedAt); assert.equal(await count(f.marker), 1); const mapping = await db.select().from(automationAgentActions).where(eq(automationAgentActions.runId, run.id)); assert.equal(mapping[0].agentRunId, result.agentRunId); console.log("CALENDAR_ACCEPTANCE_RECOVERED", result.agentRunId); }
  finally { await stop(worker.child); }
});
test("a claimed reminder cannot start the native agent after its original Key is narrowed or deleted", { timeout: 60000 }, async () => {
  const [owner] = await db.select().from(member).where(and(eq(member.organizationId, org), eq(member.userId, uid)));
  const actor: Actor = { kind: "human", userId: uid, memberId: owner.id, organizationId: org,
    workspaceId, role: "owner", name: "Owner", email: `${uid}@local.test` };
  const grant = { calendarId, canRead: true, canReadAvailability: false, canCreate: false,
    canUpdate: true, canCancel: false, canManage: false, canTriggerAgent: true };
  for (const change of ["narrow", "delete"] as const) {
    const f = await fixture();
    const saved = await createSiteKey(commandDependencies(), actor, { name: `Reminder ${change}`, permissions: [], calendarPermissions: [grant] });
    await executeCalendar({ ...commandDependencies(), workspaceId }, { kind: "key", secret: saved.secret }, "setBookingReminders", {
      calendarId, bookingId: f.booking.id, expectedVersion: 2, reminders: [f.reminder], idempotencyKey: randomUUID(),
    });
    const intent = await due(f.booking.id); assert(intent.eventId);
    const callsBefore = modelCalls;
    const worker = await startChild(intent.eventId, "BEFORE");
    try {
      await relay.tick(); await eventually(async () => worker.output().includes("CALENDAR_FAULT_BEFORE"));
      if (change === "narrow") await updateSiteKey(commandDependencies(), actor, saved.key.id, {
        name: "Read only", permissions: [], calendarPermissions: [{ ...grant, canUpdate: false, canTriggerAgent: false }],
      });
      else await deleteSiteKey(commandDependencies(), actor, saved.key.id);
      await stop(worker.child, "SIGKILL"); const replacement = await startChild();
      try {
        await eventually(async () => !!(await status(intent.eventId!)).finishedAt);
        const history = await call("listBookingReminders", { calendarId, bookingId: f.booking.id });
        const rejected = history.intents.find(item => item.id === intent.id); assert(rejected);
        assert.equal(rejected.status, "failed"); assert.equal(rejected.reason, "reminder_authorization_revoked");
        assert.equal(rejected.acceptedAt, null); assert.equal(rejected.runId, null);
        assert.equal(await count(f.marker), 0); assert.equal(modelCalls, callsBefore);
        console.log("CALENDAR_KEY_REVOKED_BEFORE_ACCEPTANCE", change, intent.id);
      } finally { await stop(replacement.child); }
    } finally { await stop(worker.child, "SIGKILL"); }
  }
});
test("committed native effect and receipt survive worker SIGKILL without replay", { timeout: 60000 }, async () => {
  const f = await fixture(); const intent = await due(f.booking.id); assert(intent.eventId);
  const worker = await startChild(intent.eventId, "AFTER");
  try {
    await relay.tick(); await eventually(async () => worker.output().includes("CALENDAR_FAULT_AFTER")); assert.equal(await count(f.marker), 1);
    await stop(worker.child, "SIGKILL"); const replacement = await startChild();
    try { await eventually(async () => !!(await status(intent.eventId!)).finishedAt); assert.equal(await count(f.marker), 1); }
    finally { await stop(replacement.child); }
  } finally { await stop(worker.child, "SIGKILL"); }
});
test("another member cannot retrieve a private reminder turn or its answer through generic native run history", { timeout: 60000 }, async () => {
  const f = await fixture(); const intent = await due(f.booking.id); assert(intent.eventId);
  const worker = await startChild();
  try {
    await relay.tick(); await eventually(async () => !!(await status(intent.eventId!)).finishedAt);
    assert.equal(await count(f.marker), 1);
    const ownerHistory = await call("listBookingReminders", { calendarId, bookingId: f.booking.id });
    const privateThread = ownerHistory.intents[0].threadId; assert(privateThread);
    const peer = { kind: "member" as const, organizationId: org, actorId: peerId };
    const peerHistory = await executeCalendar({ ...commandDependencies(), workspaceId }, peer, "listBookingReminders", { calendarId, bookingId: f.booking.id });
    assert.equal(peerHistory.intents[0].threadId, null); assert.equal(peerHistory.intents[0].runId, null);
    const [run] = await db.select().from(automationRuns).where(eq(automationRuns.eventId, intent.eventId));
    const tools = createTableTools({ ...commandDependencies(), workspaceId }, undefined, org, peerId);
    const exposed = await tools.list_automation_runs.execute({ limit: 200 }, { toolCallId: randomUUID(), messages: [], context: undefined });
    console.log("CALENDAR_OTHER_MEMBER_GENERIC_HISTORY", JSON.stringify(exposed));
    const [peerMember] = await db.select().from(member).where(and(eq(member.organizationId, org), eq(member.userId, peerId)));
    const peerActor: Actor = { kind: "human", userId: peerId, memberId: peerMember.id, organizationId: org,
      workspaceId, role: "member", name: "Other member", email: `${peerId}@local.test` };
    await assert.rejects(requireThread(commandDependencies(), privateThread, peerActor), /不存在|无权|not found/i);
    const app = new Hono().route("/api", createAutomationsRoute(async () => ({
      commands: { ...commandDependencies(), workspaceId }, identity: { database: db,
        resolveSession: async () => ({ user: { id: peerId, name: peerActor.name, email: peerActor.email }, session: { activeOrganizationId: org } }) },
      close: async () => {},
    })));
    const response = await app.request(`/api/automations/${run.automationId}/runs`);
    assert.equal(response.status, 200); const rest = await response.json();
    console.log("CALENDAR_OTHER_MEMBER_REST_HISTORY", JSON.stringify(rest));
    const privateData = (value: unknown) => ({ thread: JSON.stringify(value).includes(privateThread),
      answer: JSON.stringify(value).includes("Calendar reminder completed.") });
    assert.deepEqual({ native: privateData(exposed), rest: privateData(rest) }, {
      native: { thread: false, answer: false }, rest: { thread: false, answer: false },
    }, "Generic run history must enforce the same private-turn boundary as booking reminder history");
  } finally { await stop(worker.child); }
});
test("unknown event protocol fails durably instead of acknowledging and silently dropping the reminder", { timeout: 60000 }, async () => {
  const f = await fixture(); const intent = await due(f.booking.id); assert(intent.eventId);
  await db.update(automationEvents).set({ snapshot: { protocol: 99 } }).where(eq(automationEvents.id, intent.eventId));
  const worker = await startChild();
  try {
    await relay.tick(); await eventually(async () => (await status(intent.eventId!)).status === "failed");
    assert.match((await status(intent.eventId)).error ?? "", /protocol/);
    assert.equal(await count(f.marker), 0);
    assert.equal((await call("listBookingReminders", { calendarId, bookingId: f.booking.id })).intents[0].status, "failed");
  } finally { await stop(worker.child); }
});
test("lost wakeup and real Redis outage across commit recover SQL deadlines on service startup; expired before-start never invokes", { timeout: 60000 }, async () => {
  const expired = await fixture("before_start", 1, -60);
  assert.equal(process.env.QUEUE_TEST_REDIS_CONTAINER, "agrid-0045-redis", "Only this task's disposable Redis container may be stopped");
  execFileSync("docker", ["stop", "-t", "0", "agrid-0045-redis"]);
  let f: Awaited<ReturnType<typeof fixture>>;
  try {
    f = await fixture(); assert(await nextScheduleDeadline(commandDependencies()));
    // No notifier is installed by test/runtime. Commit remains durable while Redis is down.
    await dispatchDueBookingReminders(commandDependencies());
    assert((await db.select().from(automationOutbox).where(eq(automationOutbox.status, "pending"))).length > 0);
    assert.equal(await count(f.marker), 0);
    console.log("CALENDAR_COMMITTED_DURING_REAL_REDIS_OUTAGE", f.booking.id);
  } finally { execFileSync("docker", ["start", "agrid-0045-redis"]); }
  service = createAutomationService({ closeDatabase: false, recoveryIntervalMs: 1000 }); await service.ready;
  try {
    await eventually(async () => await count(f.marker) === 1); await eventually(async () => (await call("listBookingReminders", { calendarId, bookingId: f.booking.id })).intents[0].status === "completed");
    assert.equal(await count(expired.marker), 0); assert.equal((await call("listBookingReminders", { calendarId, bookingId: expired.booking.id })).intents[0].status, "skipped");
    assert.deepEqual(failures, []); assert(modelCalls > 0);
  } finally { await service.close(); service = undefined; }
});
