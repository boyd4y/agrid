import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import type { ExecutionAdapter, ExecutionHandle } from "@tabdo/execution";
import { createNodeProcessExecution } from "@tabdo/execution/adapters/node-process";
import { createDatabase } from "@tabdo/platform/database";
import { createPlatformAuth } from "@tabdo/platform/auth";
import { withPlatformResources } from "@tabdo/platform/resources";
import { createApp } from "../../src/app.js";
import { createDispatchedNativeStream, dispatchAcceptedNativeExecutions } from "../../src/harness/run-response.js";
import { agentExecutions, agentProfile, agentRuns, chatMessages, member, organization, session, tables, user } from "../../src/db/schema.js";

const connectionString = process.env.DATABASE_URL ?? "";
assert(new URL(connectionString).pathname.endsWith("_agent_test"), "Use an isolated *_agent_test database");
for (const key of ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "PI_API_KEY", "PI_BASE_URL"]) process.env[key] = "";

test("public process-dispatched chat preserves native SSE/history, survives browser detach, and rechecks live access", { timeout: 60000 }, async () => {
  const database = createDatabase({ connectionString, poolMax: 4 });
  const auth = createPlatformAuth({ database: database.db, appUrl: "http://localhost:5173", baseURL: "http://localhost:3001",
    secret: "dispatch-public-chat-explicit-signing-fixture-12345", production: false, sendInviteEmail: async () => {} });
  const resources = { database, auth }, db = database.db;
  const orgId = randomUUID(), agentUserId = randomUUID(), agentMemberId = randomUUID(), profileId = randomUUID();
  const users: string[] = [], handles: ExecutionHandle[] = [], ownedThreads = new Set<string>();
  let diagnostics = "", failNextLaunch = false;
  type Scenario = { marker: string; tableName: string; requests: number; gated: boolean; entered: Promise<void>; enter: () => void; released: Promise<void>; release: () => void };
  const scenarios = new Map<string, Scenario>();
  const provider = createServer(async (request, response) => {
    let raw = "";for await (const part of request) raw += part;
    const body = JSON.parse(raw) as { messages: { role: string; content: unknown; tool_call_id?: string }[] };
    const prompt = JSON.stringify(body.messages.filter(message => message.role === "user").at(-1)?.content);
    const scenario = [...scenarios.values()].find(candidate => prompt.includes(candidate.marker));
    if (!scenario) { response.writeHead(400);response.end("Unknown isolated fixture prompt");return; }
    scenario.requests++;
    response.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "public-dispatch-fixture", object: "chat.completion.chunk", created: 1,
      model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (!body.messages.some(message => message.tool_call_id === `${scenario.marker}-mutation`)) {
      send({ role: "assistant", tool_calls: [{ index: 0, id: `${scenario.marker}-mutation`, type: "function", function: { name: "create_table", arguments: JSON.stringify({ name: scenario.tableName }) } }] });
      send({}, "tool_calls");
    } else {
      send({ role: "assistant", content: `Dispatch result ${scenario.marker}: ` });
      scenario.enter();
      if (scenario.gated) await scenario.released;
      send({ content: "native tools and final history completed." });send({}, "stop");
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>(done => provider.listen(0, "127.0.0.1", done));
  const address = provider.address();assert(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  process.env.PI_API_KEY = "fixture";process.env.PI_BASE_URL = baseUrl;process.env.PI_MODEL = "fixture";
  const processExecutor = createNodeProcessExecution({ executable: process.execPath, args: ["--import", "tsx", "src/runner/node-entry.ts"],
    cwd: resolve(import.meta.dirname, "../.."), env: { DATABASE_URL: connectionString, DB_POOL_MAX: "2", NODE_ENV: "test",
      PI_API_KEY: "fixture", PI_BASE_URL: baseUrl, PI_MODEL: "fixture", OPENROUTER_API_KEY: "", OPENAI_API_KEY: "", CODEX_API_KEY: "", ANTHROPIC_API_KEY: "", CLAUDE_API_KEY: "",
      AI_RUN_TIMEOUT_MS: "30000", AI_RUN_FIRST_CHUNK_TIMEOUT_MS: "20000", AI_RUN_CHUNK_TIMEOUT_MS: "20000" },
    onOutput: (_id, _channel, bytes) => { diagnostics += Buffer.from(bytes).toString(); } });
  const execution: ExecutionAdapter = {
    async start(input) {
      const [receipt] = await db.select({ threadId: agentRuns.threadId }).from(agentExecutions)
        .innerJoin(agentRuns, eq(agentRuns.id, agentExecutions.runId)).where(eq(agentExecutions.id, input.id));
      if (!receipt || !ownedThreads.has(receipt.threadId)) throw new Error("Outside this isolated fixture");
      if (failNextLaunch) { failNextLaunch = false;throw new Error("Fixture resource boot unavailable before SDK invocation"); }
      const handle = await processExecutor.start(input);handles.push(handle);return handle;
    },
    lookup: id => processExecutor.lookup(id), close: () => processExecutor.close(),
  };
  const app = createApp({ appUrl: "http://localhost:5173", resources, streamNativeRun: createDispatchedNativeStream(execution) });
  const embeddedApp = createApp({ appUrl: "http://localhost:5173", resources });
  const request = (path: string, headers: Record<string, string>, body?: unknown, method = body === undefined ? "GET" : "POST", targetApp = app) => targetApp.request(`http://localhost:3001/api${path}`,
    { method, headers: { ...headers, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const signup = async () => {
    const response = await request("/auth/sign-up/email", { origin: "http://localhost:5173" }, { name: "Public dispatcher", email: `dispatch-${randomUUID()}@local.test`, password: "Dispatcher-fixture-123!" });
    assert.equal(response.status, 200, response.status === 200 ? "Native public admission" : await response.clone().text());
    const body = await response.json() as { user: { id: string } };users.push(body.user.id);
    return { id: body.user.id, cookie: response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
  };
  const scenario = (gated = false): Scenario => {
    const marker = `dispatch-${randomUUID()}`;
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
    const value = { marker, tableName: `table-${marker}`, requests: 0, gated, entered, enter, released, release };scenarios.set(marker, value);return value;
  };
  const submit = async (owner: { cookie: string }, headers: Record<string, string>, value: Scenario, targetApp = app) => {
    const thread = await request("/threads", { cookie: owner.cookie }, { clientId: randomUUID(), context: { page: "ai" }, agentId: agentMemberId }, "POST", targetApp);
    assert.equal(thread.status, 201, await thread.clone().text());const id = (await thread.json() as { id: string }).id;ownedThreads.add(id);
    const response = await request("/chat", headers, { id, agentId: agentMemberId, context: { page: "ai" }, intent: "message",
      messages: [{ id: randomUUID(), role: "user", parts: [{ type: "text", text: `Create the fixture table once, then complete ${value.marker}.` }] }] }, "POST", targetApp);
    assert.equal(response.status, 200, response.status === 200 ? "Native public admission" : await response.clone().text());
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.equal(response.headers.get("x-vercel-ai-ui-message-stream"), "v1");
    return { id, response };
  };
  async function waitSaved(threadId: string) {
    const deadline = Date.now() + 25000;
    for (;;) {
      const [run] = await db.select().from(agentRuns).where(eq(agentRuns.threadId, threadId));
      const [receipt] = run ? await db.select().from(agentExecutions).where(eq(agentExecutions.runId, run.id)) : [];
      if (run?.endedAt && receipt?.status === "settled") return { run, receipt };
      assert(Date.now() < deadline, diagnostics || "Dispatched native operation must settle");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try {
    await db.insert(organization).values({ id: orgId, name: "Public dispatch fixture", slug: orgId });
    const owner = await signup(), ownerMembership = randomUUID();
    await db.insert(user).values({ id: agentUserId, name: "Public runner", email: `${agentUserId}@local.test`, kind: "agent" });
    await db.insert(member).values([{ id: ownerMembership, userId: owner.id, organizationId: orgId, role: "owner" }, { id: agentMemberId, userId: agentUserId, organizationId: orgId }]);
    await db.update(session).set({ activeOrganizationId: orgId }).where(eq(session.userId, owner.id));
    await db.insert(agentProfile).values({ id: profileId, userId: agentUserId, organizationId: orgId, memberId: agentMemberId, displayName: "Public runner",
      persona: { defaultHarness: "pi", defaultModel: "fixture", runtime: "local", skillNames: [] } });

    const ordinary = scenario(), first = await submit(owner, { cookie: owner.cookie }, ordinary);
    const sse = await first.response.text();assert.match(sse, /tool-input-available/);assert.match(sse, /native tools and final history completed/);assert.match(sse, /data: \[DONE\]/);
    const complete = await waitSaved(first.id);assert.equal(complete.run.status, "completed", complete.run.error ?? diagnostics);assert.equal(complete.run.cancelRequestedAt, null);
    assert(!sse.includes(complete.receipt.id));assert(!sse.includes("node-process"));
    const history = await request(`/threads/${first.id}/messages`, { cookie: owner.cookie });assert.equal(history.status, 200);
    assert.match(JSON.stringify(await history.json()), /native tools and final history completed/);
    assert.equal((await db.select().from(tables).where(and(eq(tables.organizationId, orgId), eq(tables.name, ordinary.tableName)))).length, 1);assert.equal(ordinary.requests, 2);
    const embedded = scenario(), embeddedRun = await submit(owner, { cookie: owner.cookie }, embedded, embeddedApp);
    const embeddedSse = await embeddedRun.response.text();
    const coreChunkTypes = (source: string) => [...new Set(source.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)) as { type: string })
      .filter(chunk => ["start", "tool-input-available", "tool-output-available", "text-start", "text-delta", "text-end", "finish"].includes(chunk.type)).map(chunk => chunk.type))].sort();
    assert.deepEqual(coreChunkTypes(sse), coreChunkTypes(embeddedSse), "Both deployments emit the same public AI UI chunk contract");
    assert.match(embeddedSse, /native tools and final history completed/);assert.equal(embedded.requests, 2);
    const [embeddedSaved] = await db.select().from(agentRuns).where(eq(agentRuns.threadId, embeddedRun.id));assert.equal(embeddedSaved.status, "completed");

    const detached = scenario(true), browser = await submit(owner, { cookie: owner.cookie }, detached);
    await detached.entered;const reader = browser.response.body!.getReader();await reader.read();const browserCancelled = reader.cancel("browser closed");
    const [stillRunning] = await db.select().from(agentRuns).where(eq(agentRuns.threadId, browser.id));assert.equal(stillRunning.cancelRequestedAt, null);assert.notEqual(stillRunning.status, "cancelled");
    detached.release();await browserCancelled;reader.releaseLock();assert.equal((await waitSaved(browser.id)).run.status, "completed");assert.equal(detached.requests, 2);

    const keyResponse = await request("/user/api-keys", { cookie: owner.cookie }, { name: "Public dispatch fixture" });assert.equal(keyResponse.status, 201);
    const key = await keyResponse.json() as { key: { id: string }; secret: string };
    const keyScenario = scenario(true), keyRun = await submit(owner, { authorization: `Bearer ${key.secret}` }, keyScenario);
    const keyBody = keyRun.response.text();const keyDenied = assert.rejects(keyBody, /访问权限已失效/);
    await keyScenario.entered;
    assert.equal((await request(`/user/api-keys/${key.key.id}`, { cookie: owner.cookie }, undefined, "DELETE")).status, 200);
    await keyDenied;
    assert.equal((await request(`/threads/${keyRun.id}/messages`, { authorization: `Bearer ${key.secret}` })).status, 401);
    keyScenario.release();assert.equal((await waitSaved(keyRun.id)).run.status, "completed", "Key deletion disconnects access, not the user's accepted execution");

    const retry = scenario();failNextLaunch = true;
    const retryRun = await submit(owner, { cookie: owner.cookie }, retry);
    const [acceptedRun] = await db.select().from(agentRuns).where(eq(agentRuns.threadId, retryRun.id));
    const [accepted] = await db.select().from(agentExecutions).where(eq(agentExecutions.runId, acceptedRun.id));assert.equal(accepted.status, "accepted");assert.equal(retry.requests, 0);
    await withPlatformResources(resources, () => dispatchAcceptedNativeExecutions(execution, 32));
    assert.match(await retryRun.response.text(), /native tools and final history completed/);assert.equal((await waitSaved(retryRun.id)).run.status, "completed");assert.equal(retry.requests, 2);
    assert.equal((await db.select().from(agentRuns).where(eq(agentRuns.threadId, retryRun.id))).length, 1, "Pump retries the accepted receipt without another user Run");

    const removed = scenario(true), removedRun = await submit(owner, { cookie: owner.cookie }, removed);
    const removedBody = removedRun.response.text();
    // Membership can disappear between cookie authentication and the locked
    // execution read. Both paths deny the subscriber before final output.
    const ownerDenied = assert.rejects(removedBody, /访问权限已失效|执行不存在/);
    await removed.entered;await db.delete(member).where(eq(member.id, ownerMembership));await ownerDenied;
    assert.equal((await request(`/threads/${removedRun.id}/messages`, { cookie: owner.cookie })).status, 401);
    removed.release();await waitSaved(removedRun.id);
    const [persisted] = await db.select().from(chatMessages).where(and(eq(chatMessages.threadId, first.id), eq(chatMessages.messageId, complete.run.assistantMessageId)));
    assert(persisted.serverFinal);
  } finally {
    for (const value of scenarios.values()) value.release();
    await Promise.allSettled(handles.map(handle => handle.completion));
    await execution.close();provider.closeAllConnections();await new Promise<void>(done => provider.close(() => done()));
    await db.delete(organization).where(eq(organization.id, orgId));
    await db.delete(user).where(inArray(user.id, [...users, agentUserId]));await database.close();
  }
});
