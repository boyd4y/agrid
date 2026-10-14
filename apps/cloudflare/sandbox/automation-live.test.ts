import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { and,eq,inArray } from "drizzle-orm";
import { createDatabase } from "@tabdo/backend/database";
import { agentExecutions,agentRuns,automationAgentActions,automationEvents,automationOccurrences,automationRuns,automationSchedules,automationStepReceipts,chatThreads,member,organization,user } from "@tabdo/backend/schema";

/** Opt in against an existing dev:cf stack; never starts or builds Wrangler. */
test("live Vite APIs → Worker Queue data actions and Cron → native Sandbox scheduled history", { skip: process.env.TABDO_CF_AUTOMATION_LIVE !== "1",timeout: 180_000 },async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
  const worker = process.env.TABDO_CF_WORKER_URL || "http://localhost:8791";
  const origin = process.env.TABDO_CF_FRONTEND_ORIGIN || "http://localhost:5189";
  const marker = randomUUID(),reply = `Native scheduled answer ${marker}`;
  let cookie = "",owner = "",org = "",agentUser = "",providerCalls = 0;
  const ruleIds: string[] = [],threadIds: string[] = [];
  const fixture = createServer(async (incoming,outgoing) => {
    try {
      let raw = "";
      for await (const bytes of incoming) { raw += bytes;if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new Error("Fixture request too large"); }
      assert.match(incoming.headers.authorization || "",/^Bearer \S+$/);
      const body = JSON.parse(raw) as { messages: { role: string;content: unknown }[] };
      assert(body.messages.some(message => message.role === "user" && JSON.stringify(message.content).includes(marker)),"only this fixture's scheduled native input may reach its model");
      providerCalls++;
      outgoing.writeHead(200,{ "content-type": "text/event-stream" });
      for (const [delta,finish_reason] of [[{ role: "assistant",content: reply },null],[{},"stop"]]) outgoing.write(`data: ${JSON.stringify({ id: "cf-automation-live",object: "chat.completion.chunk",created: 1,model: "fixture-native",choices: [{ index: 0,delta,finish_reason }] })}\n\n`);
      outgoing.end("data: [DONE]\n\n");
    } catch { outgoing.writeHead(500);outgoing.end("Local automation model fixture rejected the request"); }
  });
  await new Promise<void>((done,reject) => { fixture.once("error",reject);fixture.listen(18973,"0.0.0.0",done); });
  const resource = createDatabase({ connectionString: databaseUrl,poolMax: 2 });
  const request = (path: string,init: RequestInit = {}) => fetch(`${origin}/api${path}`,{ ...init,headers: { Origin: origin,Cookie: cookie,...init.headers },signal: init.signal ?? AbortSignal.timeout(30_000) });
  const json = async <T>(path: string,body?: unknown,method = "POST"): Promise<T> => {
    const response = await request(path,{ method: body === undefined ? "GET" : method,headers: { "content-type": "application/json" },body: body === undefined ? undefined : JSON.stringify(body) });
    const jar = new Map(cookie.split("; ").filter(Boolean).map(value => [value.slice(0,value.indexOf("=")),value.slice(value.indexOf("=") + 1)]));
    for (const value of response.headers.getSetCookie()) { const pair = value.split(";")[0],separator = pair.indexOf("=");jar.set(pair.slice(0,separator),pair.slice(separator + 1)); }
    cookie = [...jar].map(([key,value]) => `${key}=${value}`).join("; ");
    const raw = await response.text();assert(response.ok,`${method} ${path}: ${response.status} ${raw.slice(0,500)}`);return JSON.parse(raw) as T;
  };
  const waitFor = async (ready: () => Promise<boolean>,label: string,timeout = 60_000) => {
    const deadline = Date.now() + timeout;
    do { if (await ready()) return;await new Promise(done => setTimeout(done,300)); } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${label}`);
  };
  const cron = async () => {
    const response = await fetch(`${worker}/__scheduled?cron=${encodeURIComponent("* * * * *")}`,{ signal: AbortSignal.timeout(30_000) });
    assert(response.ok,`Actual Wrangler Cron: ${response.status} ${(await response.text()).slice(0,500)}`);
  };
  try {
    assert((await request("/health")).ok,"Vite must proxy the running product Worker");
    const signup = await request("/auth/sign-up/email",{ method: "POST",headers: { "content-type": "application/json" },body: JSON.stringify({ email: `cf-automation-${marker}@local.test`,name: `CF automation ${marker}`,password: `Fixture-${marker}!` }) });
    const signupRaw = await signup.text();assert.equal(signup.status,200,signupRaw.slice(0,500));owner = JSON.parse(signupRaw).user.id;
    cookie = signup.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");assert(cookie);
    let me = await json<{ actor: { userId: string };organization: { id: string } | null }>("/members/me");assert.equal(me.actor.userId,owner);
    if (!me.organization) {
      const created = await json<{ id: string }>("/auth/organization/create",{ name: `CF automation ${marker}`,slug: `cf-automation-${marker}` });org = created.id;
      await json("/auth/organization/set-active",{ organizationId: org });me = await json<typeof me>("/members/me");
    }
    assert(me.organization?.id);org = me.organization.id;
    const status = await json<{ mode: string;harnesses: { id: string;available: boolean;defaultModel: string }[] }>("/chat/status");
    assert.equal(status.mode,"live");assert(status.harnesses.some(harness => harness.id === "pi" && harness.available && harness.defaultModel === "fixture-native"));
    const table = await json<{ id: string }>("/tables",{ name: `CF queued data ${marker}` });
    const column = await json<{ id: string }>(`/tables/${table.id}/columns`,{ name: "Queued output",type: "text" });
    const rule = await json<{ id: string }>(`/tables/${table.id}/automations`,{ name: `Queue mutation ${marker}`,trigger: { type: "row_created" },actions: [{ type: "update_field",columnId: column.id,value: marker }] });ruleIds.push(rule.id);
    const row = await json<{ id: string }>(`/tables/${table.id}/rows`,{ cells: {} });
    await waitFor(async () => {
      const page = await json<{ rows: { id: string;cells: Record<string,unknown> }[] }>(`/tables/${table.id}/rows`);
      return page.rows.find(item => item.id === row.id)?.cells[column.id] === marker;
    },"actual JOBS consumption of the committed row event");
    const [dataRun] = await resource.db.select().from(automationRuns).where(eq(automationRuns.automationId,rule.id));assert(dataRun);
    await waitFor(async () => (await json<{ status: string }[]>(`/automations/${rule.id}/runs`)).some(run => run.status === "completed"),"public data automation completion");
    assert.equal((await resource.db.select().from(automationStepReceipts).where(eq(automationStepReceipts.runId,dataRun.id))).length,1);
    assert.equal(providerCalls,0,"data automation requires no Harness model call");
    console.info("CF automation live: public row mutation → outbox → real JOBS → committed data action");

    const agent = await json<{ member: { id: string;userId: string } }>("/members/agents",{ name: `Scheduled native ${marker}`,persona: { defaultHarness: "pi",defaultModel: "fixture-native",runtime: "local",skillNames: [] } });agentUser = agent.member.userId;
    const schedule = await json<{ id: string }>("/automations",{ name: `Native schedule ${marker}`,source: { kind: "schedule",cron: "0 0 * * *",timeZone: "UTC" },trigger: { type: "schedule_due" },actions: [{ type: "run_agent",agentUserId: agentUser,prompt: `Return one short confirmation for ${marker}.` }] });ruleIds.push(schedule.id);
    // Only the fixture's own schedule clock is advanced; dispatch, acceptance,
    // SDK execution, checkpoint and completion all use real product services.
    await resource.db.update(automationSchedules).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(automationSchedules.automationId,schedule.id));
    await cron();
    type ScheduledHistory = { runs: { id: string;threadId: string | null;status: string;nativeStatus: string | null;preview: string | null }[] };
    let history: ScheduledHistory = { runs: [] };
    await waitFor(async () => {
      history = await json<ScheduledHistory>(`/schedules/${schedule.id}/runs`);
      return history.runs.some(run => run.threadId && run.nativeStatus === "completed" && run.preview?.includes(reply));
    },"Cron → real JOBS → DO Container → native Pi answer and saved history",100_000);
    assert.equal(history.runs.length,1);const scheduledRun = history.runs[0];assert(scheduledRun.threadId);threadIds.push(scheduledRun.threadId);
    await cron();
    await waitFor(async () => {
      history = await json<ScheduledHistory>(`/schedules/${schedule.id}/runs`);
      return history.runs[0]?.status === "completed";
    },"native completion reconciliation and automation receipt");
    const opened = await json<{ id: string;kind: string;scheduledTaskId: string }>(`/schedules/${schedule.id}/runs/${scheduledRun.threadId}`);
    assert.equal(opened.id,scheduledRun.threadId);assert.equal(opened.kind,"scheduled_task");assert.equal(opened.scheduledTaskId,schedule.id);
    const messages = await json<{ messages: unknown[] }>(`/threads/${scheduledRun.threadId}/messages`);assert(JSON.stringify(messages).includes(reply));
    const ordinary = await json<{ threads: { id: string }[] }>("/threads");assert(!ordinary.threads.some(thread => thread.id === scheduledRun.threadId));
    const [mapping] = await resource.db.select().from(automationAgentActions).where(eq(automationAgentActions.runId,scheduledRun.id));assert(mapping?.agentRunId);
    assert.equal(mapping.threadId,scheduledRun.threadId);
    const [privateThread] = await resource.db.select().from(chatThreads).where(eq(chatThreads.id,mapping.threadId));assert.equal(privateThread.userId,owner);assert.equal(privateThread.organizationId,org);
    const runs = await resource.db.select().from(agentRuns).where(eq(agentRuns.id,mapping.agentRunId));assert.equal(runs.length,1);assert.equal(runs[0].status,"completed");
    const executions = await resource.db.select().from(agentExecutions).where(eq(agentExecutions.runId,mapping.agentRunId));assert.equal(executions.length,1);assert.equal(executions[0].status,"settled");
    assert.equal((await resource.db.select().from(automationOccurrences).where(eq(automationOccurrences.automationId,schedule.id))).length,1,"second Cron is reconciliation, not another due occurrence");
    assert.equal((await resource.db.select().from(automationStepReceipts).where(eq(automationStepReceipts.runId,scheduledRun.id))).length,1);
    assert.equal(providerCalls,1,"the actual native turn is invoked once across Cron reconciliation");
    console.info("CF automation live verified: Cron→Queue→native Pi, private scheduled history, settled execution and completed automation");
  } finally {
    // Scope every cleanup to UUIDs created by this test; no truncation or global deletes.
    if (org && owner) {
      const ownThreads = await resource.db.select({ id: chatThreads.id }).from(chatThreads).where(and(eq(chatThreads.organizationId,org),eq(chatThreads.userId,owner)));
      for (const thread of ownThreads) if (!threadIds.includes(thread.id)) threadIds.push(thread.id);
    }
    for (const id of ruleIds) await request(`/automations/${id}`,{ method: "DELETE",signal: AbortSignal.timeout(10_000) }).catch(() => {});
    for (const threadId of threadIds) {
      const active = await json<{ runs: { id: string;status: string }[] }>(`/threads/${threadId}/runs`).catch(() => ({ runs: [] }));
      for (const run of active.runs.filter(run => ["starting","running"].includes(run.status))) await request(`/threads/${threadId}/runs/${run.id}/cancel`,{ method: "POST",signal: AbortSignal.timeout(10_000) }).catch(() => {});
      await request(`/threads/${threadId}`,{ method: "DELETE",signal: AbortSignal.timeout(10_000) }).catch(() => {});
    }
    fixture.closeAllConnections();await new Promise<void>(done => fixture.close(() => done()));
    if (org && owner) {
      const [own] = await resource.db.select({ id: organization.id }).from(organization).innerJoin(member,eq(member.organizationId,organization.id)).where(and(eq(organization.id,org),eq(member.userId,owner),eq(member.role,"owner")));
      if (own) {
        if (ruleIds.length) await resource.db.delete(automationRuns).where(inArray(automationRuns.automationId,ruleIds));
        await resource.db.delete(automationEvents).where(eq(automationEvents.organizationId,org));
        await resource.db.delete(organization).where(eq(organization.id,org));
      }
    }
    for (const id of [agentUser,owner].filter(Boolean)) await resource.db.delete(user).where(eq(user.id,id));
    await resource.close();
  }
});
