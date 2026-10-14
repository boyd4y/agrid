import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "@tabdo/backend/database";
import { user, organization, member, fileObjects, agentExecutions, agentRuns, agentExecutionGateways } from "@tabdo/backend/schema";

/** Opt in against an already running dev:cf stack. This test never starts Wrangler. */
test("live product Worker + DO + Docker Sandbox preserves public chat and files", { skip: process.env.TABDO_CF_PRODUCT_LIVE !== "1", timeout: 240_000 }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
  const origin = process.env.TABDO_CF_FRONTEND_ORIGIN || "http://localhost:5189";
  const marker = randomUUID(), tableName = `CF live ${marker}`;
  const question = { allowPartialAnswers: false, questions: [{ id: "direction", question: "Which direction?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], allowFreeForm: true }] };
  const answer = { action: "answered", answers: { direction: { optionIds: ["b"] } } };
  const requests: { messages: { role: string; tool_call_id?: string; content: unknown }[] }[] = [];
  let providerCalls = 0, cancelModelStarted = false, cookie = "", owner = "", org = "", agentUser = "";
  const threadIds: string[] = [];
  const fixture = createServer(async (incoming, outgoing) => {
    try {
      let raw = "";for await (const bytes of incoming) { raw += bytes;if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new Error("Fixture request too large"); }
      assert.match(incoming.headers.authorization || "", /^Bearer \S+$/);
      const body = JSON.parse(raw) as typeof requests[number];requests.push(body);providerCalls++;
      if (body.messages.some(message => message.role === "user" && JSON.stringify(message.content).includes(`CANCEL ${marker}`))) {
        cancelModelStarted = true;
        outgoing.writeHead(200, { "content-type": "text/event-stream" });outgoing.write(": waiting for persisted cancellation\n\n");return;
      }
      outgoing.writeHead(200, { "content-type": "text/event-stream" });
      const send = (delta: unknown, finish_reason: string | null = null) => outgoing.write(`data: ${JSON.stringify({ id: "cf-product-live", object: "chat.completion.chunk", created: 1, model: "fixture-native", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      const hasTable = body.messages.some(message => message.tool_call_id === "table-1");
      const hasAnswer = body.messages.some(message => message.tool_call_id === "question-1");
      if (!hasTable || !hasAnswer) {
        send({ role: "assistant", tool_calls: [{ index: 0, id: hasTable ? "question-1" : "table-1", type: "function", function: { name: hasTable ? "askUserQuestions" : "create_table", arguments: JSON.stringify(hasTable ? question : { name: tableName }) } }] });send({}, "tool_calls");
      } else { send({ role: "assistant", content: "Native answer B, no replay." });send({}, "stop"); }
      outgoing.end("data: [DONE]\n\n");
    } catch { outgoing.writeHead(500);outgoing.end("Local fixture rejected the model request"); }
  });
  await new Promise<void>(done => fixture.listen(18973, "0.0.0.0", done));
  const resource = createDatabase({ connectionString: databaseUrl, poolMax: 2 });
  const request = (path: string, init: RequestInit = {}) => fetch(`${origin}/api${path}`, { ...init, headers: { Origin: origin, Cookie: cookie, ...init.headers }, signal: init.signal ?? AbortSignal.timeout(100_000) });
  const json = async <T>(path: string, body?: unknown, method = "POST"): Promise<T> => {
    const response = await request(path, { method: body === undefined ? "GET" : method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const jar = new Map(cookie.split("; ").filter(Boolean).map(value => [value.slice(0, value.indexOf("=")), value.slice(value.indexOf("=") + 1)]));
    for (const value of response.headers.getSetCookie()) { const pair = value.split(";")[0], separator = pair.indexOf("=");jar.set(pair.slice(0, separator), pair.slice(separator + 1)); }
    cookie = [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
    const raw = await response.text();assert(response.ok, `${method} ${path}: ${response.status} ${raw.slice(0, 500)}`);return JSON.parse(raw) as T;
  };
  const waitFor = async (ready: () => Promise<boolean>, label: string, timeout = 100_000) => {
    const deadline = Date.now() + timeout;
    do { if (await ready().catch(() => false)) return;await new Promise(done => setTimeout(done, 300)); } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${label}`);
  };
  try {
    await waitFor(async () => (await request("/health", { signal: AbortSignal.timeout(3000) })).ok, "existing dev:cf Worker health", 120_000);
    const signup = await request("/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `cf-live-${marker}@local.test`, name: `CF live ${marker}`, password: `Fixture-${marker}!` }) });
    const signupBody = await signup.text();assert.equal(signup.status, 200, signupBody.slice(0, 500));owner = JSON.parse(signupBody).user.id;
    cookie = signup.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");assert(cookie);
    let me = await json<{ actor: { userId: string }; organization: { id: string } | null }>("/members/me");
    assert.equal(me.actor.userId, owner);
    if (!me.organization) {
      const created = await json<{ id: string }>("/auth/organization/create", { name: `CF live ${marker}`, slug: `cf-live-${marker}` });org = created.id;
      await json("/auth/organization/set-active", { organizationId: org });
      me = await json<typeof me>("/members/me");
    }
    assert(me.organization?.id, "public onboarding creates and activates a workspace");org = me.organization.id;
    await waitFor(async () => {
      const status = await json<{ mode: string; harnesses: { id: string; provider?: string; defaultModel: string; available: boolean }[] }>("/chat/status");
      return status.mode === "live" && status.harnesses.some(harness => harness.id === "pi" && harness.available && harness.provider === "pi" && harness.defaultModel === "fixture-native");
    }, "explicit local fixture model configuration", 120_000);
    const agent = await json<{ member: { id: string; userId: string } }>("/members/agents", { name: `Native ${marker}`, persona: { defaultHarness: "pi", defaultModel: "fixture-native", runtime: "local", skillNames: [] } });
    agentUser = agent.member.userId;
    console.info("CF live: public signup, organization and agent ready");
    const createThread = async () => {
      const thread = await json<{ id: string }>("/threads", { clientId: randomUUID(), context: { page: "ai" }, agentId: agent.member.id });threadIds.push(thread.id);return thread.id;
    };
    const threadId = await createThread();
    const chatBase = { id: threadId, context: { page: "ai" }, agentId: agent.member.id };
    const first = await request("/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...chatBase, messages: [{ id: randomUUID(), role: "user", parts: [{ type: "text", text: `Create one table ${tableName}, then ask my direction.` }] }] }) });
    assert.equal(first.status, 200, (await first.clone().text()).slice(0, 500));
    const firstStream = await first.text();assert.match(firstStream, /askUserQuestions/);
    const { runs: pending } = await json<{ runs: { id: string; assistantMessageId: string; status: string }[] }>(`/threads/${threadId}/runs`);
    assert.equal(pending.length, 1);assert.equal(pending[0].status, "suspended");assert.equal(providerCalls, 2);
    console.info("CF live: native tool write and suspended question verified");
    const tables = await json<{ id: string; name: string }[]>("/tables");
    const createdTable = tables.find(table => table.name === tableName);assert(createdTable);assert.equal(tables.filter(table => table.name === tableName).length, 1);
    const resumed = await request("/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...chatBase, intent: "tool-result", assistantMessageId: pending[0].assistantMessageId, toolResults: [{ toolCallId: "question-1", output: answer }] }) });
    assert.equal(resumed.status, 200, (await resumed.clone().text()).slice(0, 500));assert.match(await resumed.text(), /Native answer B, no replay/);
    const { runs: completed } = await json<{ runs: { id: string; status: string }[] }>(`/threads/${threadId}/runs`);
    assert.equal(completed.length, 1);assert.equal(completed[0].id, pending[0].id);assert.equal(completed[0].status, "completed");assert.equal(providerCalls, 3);
    console.info("CF live: independent native execution resumed the same Run");
    const nativeAnswer = requests[2].messages.filter(message => message.tool_call_id === "question-1");assert.equal(nativeAnswer.length, 1);assert.deepEqual(JSON.parse(nativeAnswer[0].content as string), answer);
    assert.equal(requests[2].messages.filter(message => message.role === "user").length, 1);
    const receipts = await resource.db.select({ id: agentExecutions.id, launchToken: agentExecutionGateways.launchToken, status: agentExecutions.status }).from(agentExecutions)
      .innerJoin(agentRuns, eq(agentRuns.id, agentExecutions.runId)).innerJoin(agentExecutionGateways, eq(agentExecutionGateways.executionId, agentExecutions.id)).where(eq(agentRuns.id, pending[0].id));
    assert.equal(receipts.length, 2);assert.notEqual(receipts[0].launchToken, receipts[1].launchToken);assert(receipts.every(receipt => receipt.status === "settled"));
    const column = await json<{ id: string }>(`/tables/${createdTable.id}/columns`, { name: `Files ${marker}`, type: "file", config: { file: { multiple: true } } });
    const form = new FormData();form.append("files", new File(["hello from Cloudflare R2"], `live-${marker}.txt`, { type: "text/plain" }));
    const uploaded = await request(`/tables/${createdTable.id}/columns/${column.id}/files`, { method: "POST", body: form });assert.equal(uploaded.status, 201, (await uploaded.clone().text()).slice(0, 500));
    const files = await uploaded.json() as { files: { id: string }[] };assert.equal(files.files.length, 1);
    const downloaded = await request(`/files/${files.files[0].id}/download`);assert.equal(downloaded.status, 200);assert.equal(await downloaded.text(), "hello from Cloudflare R2");
    console.info("CF live: R2 upload and download verified");
    const cancelThread = await createThread();
    const cancelResponse = await request("/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...chatBase, id: cancelThread, messages: [{ id: randomUUID(), role: "user", parts: [{ type: "text", text: `CANCEL ${marker}` }] }] }) });
    assert.equal(cancelResponse.status, 200);const cancelStream = cancelResponse.text();
    await waitFor(async () => cancelModelStarted, "native model cancellation fixture", 20_000);
    const { runs: active } = await json<{ runs: { id: string }[] }>(`/threads/${cancelThread}/runs`);assert.equal(active.length, 1);
    await json(`/threads/${cancelThread}/runs/${active[0].id}/cancel`, {});
    assert(!((await cancelStream).includes("系统提示：已停止执行")));
    await waitFor(async () => (await json<{ runs: { status: string }[] }>(`/threads/${cancelThread}/runs`)).runs[0]?.status === "cancelled", "persisted cancelled Run", 15_000);
    const history = await json<{ messages: { content: unknown }[] }>(`/threads/${cancelThread}/messages`);assert(!JSON.stringify(history).includes("系统提示：已停止执行"));
    console.info("CF live verified: signup/org, agent, DO→native Pi, tool write, question cold resume, R2 upload/download, persisted cancel");
  } finally {
    // Ask the public application to destroy only this fixture's own containers.
    for (const threadId of threadIds) {
      const runs = await json<{ runs: { id: string; status: string }[] }>(`/threads/${threadId}/runs`).catch(() => ({ runs: [] }));
      for (const run of runs.runs.filter(run => ["starting", "running"].includes(run.status)))
        await request(`/threads/${threadId}/runs/${run.id}/cancel`, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => {});
      await request(`/threads/${threadId}`, { method: "DELETE", signal: AbortSignal.timeout(10_000) }).catch(() => {});
    }
    fixture.closeAllConnections();await new Promise<void>(done => fixture.close(() => done()));
    if (org) {
      const [createdOrg] = await resource.db.select({ id: organization.id }).from(organization).innerJoin(member, eq(member.organizationId, organization.id)).where(and(eq(organization.id, org), eq(member.userId, owner), eq(member.role, "owner")));
      if (createdOrg) {
        const uploads = await resource.db.select({ storageKey: fileObjects.storageKey }).from(fileObjects).where(eq(fileObjects.organizationId, org));
        if (uploads.length) console.info("Own local R2 fixture object keys for cleanup:", uploads.map(file => file.storageKey).join(","));
        await resource.db.delete(organization).where(eq(organization.id, org));
      }
    }
    for (const id of [agentUser, owner].filter(Boolean)) await resource.db.delete(user).where(eq(user.id, id));
    await resource.close();
  }
});
