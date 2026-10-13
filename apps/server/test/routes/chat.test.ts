import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";

// Integration tests must never connect to the application database or a live model.
if (!process.env.DATABASE_URL?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
for (const key of ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "PI_API_KEY", "PI_BASE_URL"]) process.env[key] = "";
const { db, client } = await import("../../src/db/index.js");
const { auth } = await import("../../src/auth/index.js");
const { chatRoute } = await import("../../src/routes/chat.js");
const { threadsRoute } = await import("../../src/routes/threads.js");
const { tablesRoute } = await import("../../src/routes/tables.js");
const { membersRoute } = await import("../../src/routes/members.js");
const { organization, member, session, user, agentProfile, chatMessages, chatThreads, agentRuntimeSessions } = await import("../../src/db/schema.js");
const { resolveChatContext } = await import("../../src/chat/context.js");
const { createTableTools } = await import("../../src/ai/tools.js");
const { createTable } = await import("../../src/commands/index.js");
const { saveMessage, loadMessages } = await import("../../src/chat/store.js");

const app = new Hono().route("/api/threads", threadsRoute).route("/api/chat", chatRoute).route("/api/members", membersRoute).route("/api/tables", tablesRoute);
app.onError((err, c) => {
  if ("getResponse" in err && typeof err.getResponse === "function") return err.getResponse();
  return c.json({ error: err.message }, err.name === "ZodError" ? 400 : 500);
});
const orgId = randomUUID(), otherOrg = randomUUID();
const users: string[] = [];
let cookie = "", otherCookie = "", ownerId = "", agentId = "", agentUserId = "", threadId = "", tableId = "", foreignTableId = "";
const req = async (path: string, body?: unknown, method = "POST", authCookie = cookie) => app.request(`http://localhost:3001/api${path}`, { method: body === undefined && method === "POST" ? "GET" : method, headers: { Cookie: authCookie, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const actor = () => ({ userId: ownerId, organizationId: orgId, kind: "human" as const, memberId: "owner", role: "owner", name: "Owner", email: "test@local.test" });

async function signUp() {
  const response = await auth.handler(new Request("http://localhost:3001/api/auth/sign-up/email", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" }, body: JSON.stringify({ email: `chat-${randomUUID()}@local.test`, password: "Test-chat-password-123!", name: "Chat Test" }) }));
  assert.equal(response.status, 200);
  const body = await response.json();
  users.push(body.user.id);
  return { userId: body.user.id as string, cookie: response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}
before(async () => {
  const a = await signUp(), b = await signUp();
  ownerId = a.userId; cookie = a.cookie; otherCookie = b.cookie;
  await db.insert(organization).values([{ id: orgId, name: "Chat Workspace", slug: orgId }, { id: otherOrg, name: "Other Workspace", slug: otherOrg }]);
  await db.insert(member).values([{ id: randomUUID(), userId: ownerId, organizationId: orgId, role: "owner" }, { id: randomUUID(), userId: b.userId, organizationId: orgId, role: "member" }, { id: randomUUID(), userId: ownerId, organizationId: otherOrg, role: "owner" }]);
  await db.update(session).set({ activeOrganizationId: orgId }).where(eq(session.userId, ownerId));
  await db.update(session).set({ activeOrganizationId: orgId }).where(eq(session.userId, b.userId));
  tableId = (await createTable({ organizationId: orgId, name: "Explicit table" })).id;
  foreignTableId = (await createTable({ organizationId: otherOrg, name: "Foreign table" })).id;
});
after(async () => {
  for (const id of [orgId, otherOrg]) await db.delete(organization).where(eq(organization.id, id));
  for (const id of [...users, agentUserId].filter(Boolean)) await db.delete(user).where(eq(user.id, id));
  await client.end();
});

test("agent creation uses a human session, creates no key, and enforces roles", async () => {
  assert.equal((await req("/members/agents", { name: "Forbidden" }, "POST", otherCookie)).status, 403);
  const response = await req("/members/agents", { name: "Builtin assistant", persona: { defaultHarness: "pi", defaultModel: "openrouter/free" } });
  assert.equal(response.status, 201);
  const result = await response.json(); agentId = result.member.id; agentUserId = result.member.userId;
  assert.equal(result.apiKey, undefined); assert.equal(result.member.agent.apiKeyPrefix, undefined);
  const [profile] = await db.select().from(agentProfile).where(eq(agentProfile.userId, agentUserId));
  assert.equal(profile.apiKeyHash, null); assert.equal(profile.apiKeyPrefix, null);
  assert.equal(profile.persona.runtime, "local");
  assert.equal((await req("/members/agents", { name: "Unsupported local", persona: { defaultHarness: "codex", runtime: "local" } })).status, 400);
  assert.equal((await req("/members/agents", { name: "Invalid native model", persona: { defaultHarness: "claude", defaultModel: "openrouter/free" } })).status, 400);
  const native = await req("/members/agents", { name: "Native Codex", persona: { defaultHarness: "codex" } });
  assert.equal(native.status, 201);
  const codex = (await native.json()).member; users.push(codex.userId);
  assert.equal(codex.agent.persona.runtime, "sandbox"); assert.equal(codex.agent.persona.defaultModel, "__harness_default__");
  assert.equal((await req(`/members/agents/${codex.id}`, { persona: { runtime: "local" } }, "PATCH")).status, 400);
});

test("agent platform tool settings normalize legacy IDs, persist, and enforce owner role", async () => {
  const catalog = await (await req("/members/agents/tools?harness=pi")).json();
  assert.equal(catalog.harness, "pi"); assert.equal(catalog.supportsFiltering, true);
  for (const id of ["update_cell", "read_skill"]) assert(catalog.tools.some((item: {id:string}) => item.id === id));
  assert(catalog.tools.every((item: {source:string}) => item.source === "platform"));
  assert(!catalog.tools.some((item: {id:string}) => item.id === "webSearch"));
  assert.equal((await req("/members/agents/tools?harness=unsupported")).status, 400);
  assert.equal((await req(`/members/agents/${agentId}`, { persona: { disabledTools: ["bash"] } }, "PATCH", otherCookie)).status, 403);
  for (const disabledTools of [["unknown_tool"], ["bash", "bash"]]) {
    assert.equal((await req(`/members/agents/${agentId}`, { persona: { disabledTools } }, "PATCH")).status, 400);
  }
  const legacy = ["bash", "update_cell", "read_skill", "update_plan"];
  const disabled = ["update_cell", "read_skill"];
  assert.equal((await req(`/members/agents/${agentId}`, { persona: { disabledTools: legacy } }, "PATCH")).status, 200);
  const [profile] = await db.select().from(agentProfile).where(eq(agentProfile.userId, agentUserId));
  assert.deepEqual(profile.persona.disabledTools, disabled);
  const members = await (await req("/members")).json();
  assert.deepEqual(members.members.find((item: {id:string}) => item.id === agentId).agent.persona.disabledTools, disabled);
  // Unrelated edits retain configuration; [] explicitly re-enables everything.
  assert.equal((await req(`/members/agents/${agentId}`, { name: "Builtin assistant" }, "PATCH")).status, 200);
  const [retained] = await db.select().from(agentProfile).where(eq(agentProfile.userId, agentUserId));
  assert.deepEqual(retained.persona.disabledTools, disabled);
  assert.equal((await req(`/members/agents/${agentId}`, { persona: { disabledTools: [] } }, "PATCH")).status, 200);
  const normalized = await req("/members/agents", { name: "Legacy native tools", persona: { defaultHarness: "codex", disabledTools: ["read", "webSearch", "create_goal"] } });
  assert.equal(normalized.status, 201);
  const created = (await normalized.json()).member; users.push(created.userId);
  assert.deepEqual(created.agent.persona.disabledTools, []);
});

test("workspace table icons and pins persist and reject invalid or foreign changes", async () => {
  const response = await req(`/tables/${tableId}`, { icon: "Rocket", pinned: true }, "PATCH");
  assert.equal(response.status, 200);
  const full = await (await req(`/tables/${tableId}`)).json();
  assert.equal(full.icon, "Rocket"); assert.equal(full.pinned, true);
  const listed = await (await req("/tables")).json();
  assert.equal(listed.find((table: { id: string }) => table.id === tableId).icon, "Rocket");
  for (const icon of ["Tent", "HardDrive"]) {
    const picked = await req(`/tables/${tableId}`, { icon }, "PATCH");
    assert.equal(picked.status, 200, `picker icon ${icon} accepted`);
    assert.equal((await picked.json()).icon, icon);
  }
  const reloaded = await (await req(`/tables/${tableId}`)).json();
  assert.equal(reloaded.icon, "HardDrive");
  assert.equal((await req(`/tables/${tableId}`, { icon: "unknown-icon" }, "PATCH")).status, 200);
  assert.equal((await (await req(`/tables/${tableId}`)).json()).icon, "unknown-icon");
  for (const icon of [42, " ", "x".repeat(101)]) {
    assert.equal((await req(`/tables/${tableId}`, { icon }, "PATCH")).status, 400);
  }
  assert.equal((await req(`/tables/${tableId}`, { pinned: "true" }, "PATCH")).status, 400);
  assert.equal((await req(`/tables/${foreignTableId}`, { pinned: true }, "PATCH")).status, 404);
  assert.equal((await req(`/tables/${tableId}`, { icon: null, pinned: false }, "PATCH")).status, 200);
  const restored = await (await req(`/tables/${tableId}`)).json();
  assert.equal(restored.icon, null); assert.equal(restored.pinned, false);
});

test("context has no implicit table and rejects forged table scopes", async () => {
  const home = await resolveChatContext({ page: "ai" }, actor());
  assert.equal(home.resourceKey, "workspace"); assert.match(home.system, /没有绑定任何表格/);
  await assert.rejects(resolveChatContext({ page: "ai", tableId }, actor()), /不应绑定表格/);
  await assert.rejects(resolveChatContext({ page: "table", tableId: foreignTableId }, actor()), /不属于当前工作区/);
  const table = await resolveChatContext({ page: "table", tableId }, actor());
  assert.match(table.system, /Explicit table/); assert.equal(table.resourceKey, `table:${tableId}`);
});

test("thread initialization is idempotent and concurrent client appends do not choose native history", async () => {
  const body = { clientId: randomUUID(), context: { page: "ai" }, agentId };
  const results = await Promise.all(Array.from({ length: 5 }, () => req("/threads", body).then((r) => r.json())));
  assert.equal(new Set(results.map((r) => r.id)).size, 1); threadId = results[0].id;
  const message = { id: "user-1", parentId: null, format: "ai-sdk/v6", content: { role: "user", parts: [{ type: "text", text: "列出工作区表格" }] } };
  const writes = await Promise.all(Array.from({ length: 5 }, () => req(`/threads/${threadId}/messages`, message)));
  assert(writes.every((r) => r.status === 200));
  const history = await loadMessages(threadId, actor());
  assert.equal(history.messages.length, 0);assert.equal(history.headId, null);
});

test("an unconfigured native runtime returns an explicit error without creating a fake reply", async () => {
  const before = await loadMessages(threadId, actor());
  const response = await req("/chat", { id: threadId, agentId, context: { page: "ai" }, messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "列出工作区表格" }] }] });
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Pi 未配置模型提供商/);
  assert.deepEqual(await loadMessages(threadId, actor()), before);
  assert.deepEqual(await (await req(`/threads/${threadId}/runs`)).json(), { runs: [] });
});

test("history preserves structured tools and branching across reloads", async () => {
  await saveMessage(threadId, actor(), { id: "user-1", parentId: null, format: "ai-sdk/v6", content: { role: "user", parts: [{ type: "text", text: "Server accepted input" }] } }, true);
  const firstReply = { id: "first-fixture-reply", parentId: "user-1", format: "ai-sdk/v6", content: { role: "assistant", parts: [{ type: "text", text: "First branch" }] } };
  await saveMessage(threadId, actor(), firstReply, true);
  await req(`/threads/${threadId}/messages`, { ...firstReply, content: { role: "assistant", parts: [{ type: "text", text: "stale" }] } });
  assert.deepEqual((await loadMessages(threadId, actor())).messages.find((m) => m.id === firstReply.id)?.content, firstReply.content);
  const stored = { id: "tool-response", parentId: "user-1", format: "ai-sdk/v6", content: { role: "assistant", parts: [{ type: "tool-get_table", toolCallId: "call-1", state: "output-available", input: { tableId }, output: { name: "Explicit table" } }, { type: "text", text: "Loaded" }], metadata: { agentId } } };
  await saveMessage(threadId, actor(), stored, true);
  const restored = await (await req(`/threads/${threadId}/messages`)).json();
  assert.equal(restored.headId, stored.id); assert.deepEqual(restored.messages.find((m: { id: string }) => m.id === stored.id).content, stored.content);
  assert.equal(restored.messages.length, 3);
});

test("the live streaming path injects validated system context and persists tool results", async () => {
  const calls: Array<{ messages: { role: string; content: unknown }[] }> = [];
  const provider = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") { response.writeHead(200, { "Content-Type": "application/json" });response.end(JSON.stringify({ data: [{ id: "openrouter/free", context_length: 200000, top_provider: { max_completion_tokens: null } }] }));return; }
    let raw = "";
    for await (const chunk of request) raw += chunk;
    calls.push(JSON.parse(raw));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const write = (delta: unknown, finish_reason: string | null) => response.write(`data: ${JSON.stringify({ id: "completion-test", object: "chat.completion.chunk", created: 1, model: "openrouter/free", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (calls.length === 1) {
      write({ role: "assistant", tool_calls: [{ index: 0, id: "get-table-test", type: "function", function: { name: "get_table", arguments: JSON.stringify({ tableId }) } }] }, null);
      write({}, "tool_calls");
    } else {
      write({ role: "assistant", content: "已查看指定表格。" }, null);
      write({}, "stop");
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address(); assert(address && typeof address !== "string");
  const previousURL = process.env.OPENROUTER_BASE_URL;
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.OPENROUTER_API_KEY = "local-test-provider";
  try {
    const thread = await (await req("/threads", { clientId: randomUUID(), context: { page: "table", tableId }, agentId })).json();
    const response = await req("/chat", { id: thread.id, agentId, context: { page: "table", tableId }, messages: [{ id: "live-user", role: "user", parts: [{ type: "text", text: "查看指定表格" }] }] });
    assert.equal(response.status, 200); assert.match(await response.text(), /已查看指定表格/);
    assert.equal(calls.length, 2);
    assert.match(String(calls[0].messages.find((m) => m.role === "system")?.content), /表格详情[\s\S]*Explicit table/);
    assert(calls[1].messages.some((m) => m.role === "tool"));
    const history = await loadMessages(thread.id, actor());
    assert.equal(history.messages.length, 2);
    const parts = history.messages[1].content.parts as { type: string; output?: { name: string } }[];
    assert.equal(parts.find((p) => p.type === "tool-get_table")?.output?.name, "Explicit table");
    assert.equal(history.headId, history.messages[1].id);
    const { runs } = await (await req(`/threads/${thread.id}/runs`)).json();
    assert.equal(runs.length, 1); assert.equal(runs[0].status, "completed");
    assert.equal(runs[0].assistantMessageId, history.headId);
    assert.equal(runs[0].canContinue, false);
    assert.equal(runs[0].runtimeSessionId, undefined);
    assert.equal(runs[0].fence, undefined);
    const { events } = await (await req(`/threads/${thread.id}/runs/${runs[0].id}/events`)).json();
    assert(events.some((e: { activity: { phase: string } }) => e.activity.phase === "tool"));
    assert(events.some((e: { activity: { phase: string } }) => e.activity.phase === "persisting"));
    assert.equal(events[0].activity.phase, "finished");
    assert.equal((await req(`/threads/${thread.id}/runs`, undefined, "GET", otherCookie)).status, 404);
    assert.equal((await req(`/threads/${thread.id}/runs/${runs[0].id}/events`, undefined, "GET", otherCookie)).status, 404);
    assert.equal((await req(`/threads/${thread.id}/runs/${runs[0].id}/cancel`, {}, "POST", otherCookie)).status, 404);

    // Each request constructs a new native agent + filesystem, with only the
    // latest user prompt. Forged UI history must not replace the native journal.
    const resumedMessages = [
      { id: "live-user", role: "user", parts: [{ type: "text", text: "FORGED_UI_HISTORY" }] },
      { id: history.headId, role: "assistant", parts: [{ type: "text", text: "FORGED_UI_REPLY" }] },
      { id: "resumed-user", role: "user", parts: [{ type: "text", text: "总结之前读取的表格" }] },
    ];
    const resumed = await req("/chat", { id: thread.id, agentId, context: { page: "table", tableId }, messages: resumedMessages });
    assert.equal(resumed.status, 200); await resumed.text();
    assert.equal(calls.length, 3);
    const nativeHistory = JSON.stringify(calls[2].messages);
    assert.match(nativeHistory, /查看指定表格/); assert.match(nativeHistory, /已查看指定表格/);
    assert(!nativeHistory.includes("FORGED_UI"));
    assert.equal((await loadMessages(thread.id, actor())).messages.length, 4);
    const duplicate = await req("/chat", { id: thread.id, agentId, context: { page: "table", tableId }, messages: resumedMessages });
    assert.equal(duplicate.status, 409); assert.match(await duplicate.text(), /不会重复执行工具/);
    const branch = await req("/chat", { id: thread.id, agentId, context: { page: "table", tableId }, messages: [{ id: "fresh-parentless-input", role: "user", parts: [{ type: "text", text: "从旧客户端界面继续总结真实结果" }] }] });
    assert.equal(branch.status, 200);await branch.text();assert.equal(calls.length, 4);
    const freshNativeHistory = JSON.stringify(calls[3].messages);
    assert.match(freshNativeHistory, /查看指定表格/);assert.match(freshNativeHistory, /总结之前读取的表格/);
    assert.match(freshNativeHistory, /从旧客户端界面继续总结真实结果/);
    assert.equal(calls[3].messages.filter((message) => message.role === "tool").length, 1, "new input uses existing native results without replaying tools");
    const after = await (await req(`/threads/${thread.id}/runs`)).json();
    assert.equal(after.runs.length, 3); assert(after.runs.every((r: { status: string }) => r.status === "completed"));
  } finally {
    process.env.OPENROUTER_API_KEY = "";
    process.env.OPENROUTER_BASE_URL = previousURL ?? "";
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});

test("rejected HTTP inputs and stale client heads do not block a fresh native turn or replay tools", { timeout: 15_000 }, async () => {
  const calls: { messages: { role: string; content: unknown }[] }[] = [];
  const tableName = `Canonical-head-${randomUUID()}`;
  const provider = createServer(async (request, response) => {
    if (request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "openrouter/free", context_length: 200000, top_provider: { max_completion_tokens: null } }] }));return;
    }
    let raw = "";for await (const chunk of request) raw += chunk;
    calls.push(JSON.parse(raw));response.writeHead(200, { "Content-Type": "text/event-stream" });
    const write = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "canonical-head", object: "chat.completion.chunk", created: 1, model: "openrouter/free", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    write({ role: "assistant" });
    if (calls.length === 1) {
      write({ tool_calls: [{ index: 0, id: "canonical-create-once", type: "function", function: { name: "create_table", arguments: JSON.stringify({ name: tableName }) } }] });write({}, "tool_calls");
    } else { write({ content: calls.length === 2 ? "真实表格已创建。" : "原生历史已保留，按最新输入继续。" });write({}, "stop"); }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();assert(address && typeof address !== "string");
  const previousURL = process.env.OPENROUTER_BASE_URL;
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${address.port}/v1`;process.env.OPENROUTER_API_KEY = "canonical-local-fixture";
  try {
    const thread = await (await req("/threads", { clientId: randomUUID(), context: { page: "ai" }, agentId })).json();
    const initialUser = { id: "canonical-first-user", role: "user", parts: [{ type: "text", text: "CANONICAL_ACCEPTED_CREATE_ONCE" }] };
    const first = await req("/chat", { id: thread.id, agentId, context: { page: "ai" }, messages: [initialUser] });
    assert.equal(first.status, 200);await first.text();assert.equal(calls.length, 2);
    const canonical = await loadMessages(thread.id, actor());assert(canonical.headId);
    const rejected = [
      { id: "http-rejected-one", role: "user", parts: [{ type: "text", text: "REJECTED_HTTP_FIRST_DO_NOT_EXECUTE" }] },
      { id: "http-rejected-two", role: "user", parts: [{ type: "text", text: "REJECTED_HTTP_SECOND_DO_NOT_EXECUTE" }] },
    ];
    process.env.OPENROUTER_API_KEY = "";
    for (const input of rejected) {
      const response = await req("/chat", { id: thread.id, agentId, context: { page: "ai" }, messages: [input] });
      assert.equal(response.status, 503);assert.match(await response.text(), /Pi 未配置模型提供商/);
    }
    assert.equal(calls.length, 2, "preflight rejection never starts a native turn");
    process.env.OPENROUTER_API_KEY = "canonical-local-fixture";
    // Seed only this test thread to reproduce rows written by the older client
    // persistence path. The current compatibility endpoint must not create them.
    const seedTime = Date.now();
    await db.insert(chatMessages).values(rejected.map((input, index) => ({ threadId: thread.id, messageId: input.id, parentId: index ? rejected[0].id : canonical.headId,
      content: { role: input.role, parts: input.parts }, serverFinal: false, createdAt: new Date(seedTime + index) })));
    await db.update(chatThreads).set({ headId: rejected[1].id }).where(eq(chatThreads.id, thread.id));
    const stale = await (await req(`/threads/${thread.id}/messages`)).json();
    assert.equal(stale.headId, canonical.headId, "GET projects the accepted native head rather than an unexecuted client row");
    assert.equal((await req(`/threads/${thread.id}/messages`, { id: "client-append-noop", parentId: rejected[1].id, format: "ai-sdk/v6", content: { role: "user", parts: [{ type: "text", text: "CLIENT_APPEND_MUST_NOT_RUN" }] } })).status, 200);
    assert.equal((await req(`/threads/${thread.id}/messages`, { id: initialUser.id, parentId: null, format: "ai-sdk/v6", content: { role: "user", parts: [{ type: "text", text: "CLIENT_UPDATE_MUST_NOT_REPLACE" }] } })).status, 200);
    const unchanged = await loadMessages(thread.id, actor());
    assert(!unchanged.messages.some((message) => message.id === "client-append-noop"));
    assert.deepEqual(unchanged.messages.find((message) => message.id === initialUser.id)?.content.parts, initialUser.parts);
    const latest = { id: "canonical-latest-user", role: "user", parts: [{ type: "text", text: "LATEST_INPUT_USE_THE_EXISTING_TABLE" }] };
    // Reproduce the append/Run race for an already-present, unexecuted user:
    // its stale client parent can be normalized because no Run owns that row.
    await db.insert(chatMessages).values({ threadId: thread.id, messageId: latest.id, parentId: rejected[1].id, content: { role: latest.role, parts: latest.parts }, serverFinal: false, createdAt: new Date(seedTime + 2) });
    await db.update(chatThreads).set({ headId: latest.id }).where(eq(chatThreads.id, thread.id));
    const resumed = await req("/chat", { id: thread.id, agentId, context: { page: "ai" }, messages: [...stale.messages.map((message: { id: string; content: Record<string, unknown> }) => ({ id: message.id, ...message.content })), latest] });
    assert.equal(resumed.status, 200);assert.match(await resumed.text(), /按最新输入继续/);assert.equal(calls.length, 3);
    const nativeHistory = JSON.stringify(calls[2].messages);
    assert.match(nativeHistory, /CANONICAL_ACCEPTED_CREATE_ONCE/);assert(nativeHistory.includes(tableName));assert.match(nativeHistory, /LATEST_INPUT_USE_THE_EXISTING_TABLE/);
    assert(!nativeHistory.includes("REJECTED_HTTP") && !nativeHistory.includes("CLIENT_APPEND") && !nativeHistory.includes("CLIENT_UPDATE"), "unexecuted UI inputs never enter the native journal");
    const restored = await loadMessages(thread.id, actor());
    assert.equal(restored.messages.find((message) => message.id === latest.id)?.parentId, canonical.headId, "the server chooses the accepted canonical parent");
    const runs = await (await req(`/threads/${thread.id}/runs`)).json();
    assert.equal(runs.runs.length, 2);assert(runs.runs.every((run: { status: string }) => run.status === "completed"));
    const tables = await (await req("/tables")).json();
    assert.equal(tables.filter((table: { name: string }) => table.name === tableName).length, 1, "existing native tool results are not replayed");
  } finally {
    process.env.OPENROUTER_API_KEY = "";process.env.OPENROUTER_BASE_URL = previousURL ?? "";
    provider.closeAllConnections();await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});

test("progress event insertion failures remain observational and do not abort native tools or final persistence", { timeout: 15_000 }, async () => {
  const calls: { messages: { role: string; content: unknown }[] }[] = [];
  const tableName = `Observer-fault-${randomUUID()}`;
  const provider = createServer(async (request, response) => {
    if (request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "openrouter/free", context_length: 200000, top_provider: { max_completion_tokens: null } }] }));return;
    }
    let raw = "";for await (const chunk of request) raw += chunk;
    calls.push(JSON.parse(raw));response.writeHead(200, { "Content-Type": "text/event-stream" });
    const write = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "observer-fault", object: "chat.completion.chunk", created: 1, model: "openrouter/free", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    write({ role: "assistant" });
    if (calls.length === 1) {
      write({ tool_calls: [{ index: 0, id: "observer-create-once", type: "function", function: { name: "create_table", arguments: JSON.stringify({ name: tableName }) } }] });write({}, "tool_calls");
    } else { write({ content: "真实工具已完成，进度记录故障不影响保存回复。" });write({}, "stop"); }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();assert(address && typeof address !== "string");
  const previousURL = process.env.OPENROUTER_BASE_URL;
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${address.port}/v1`;process.env.OPENROUTER_API_KEY = "local-observer-fault-provider";
  const faultName = `progress_fault_${randomUUID().replaceAll("-", "")}`;
  try {
    const thread = await (await req("/threads", { clientId: randomUUID(), context: { page: "ai" }, agentId })).json();
    assert.match(thread.id, /^[0-9a-f-]{36}$/);
    // These identifiers and the UUID come only from this isolated fixture.
    // The trigger passes every other thread, including concurrent test suites.
    await client.unsafe(`CREATE FUNCTION ${faultName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF EXISTS (SELECT 1 FROM agent_runs WHERE id = NEW.run_id AND thread_id = '${thread.id}'::uuid) THEN
        RAISE EXCEPTION 'fixture_progress_observer_failure';
      END IF;
      RETURN NEW;
    END $$`);
    await client.unsafe(`CREATE TRIGGER ${faultName} BEFORE INSERT ON agent_run_events FOR EACH ROW EXECUTE FUNCTION ${faultName}()`);
    const response = await req("/chat", { id: thread.id, agentId, context: { page: "ai" }, messages: [{ id: "observer-fault-user", role: "user", parts: [{ type: "text", text: "创建一次真实表格并保存回复" }] }] });
    assert.equal(response.status, 200);const stream = await response.text();
    assert.match(stream, /真实工具已完成，进度记录故障不影响保存回复/);
    assert(!stream.includes("系统提示") && !stream.includes("本轮未能完成") && !stream.includes('"type":"error"'), "observer failure is not projected as a native execution failure");
    assert.equal(calls.length, 2);assert.equal(calls[1].messages.filter((message) => message.role === "tool").length, 1);
    const { runs } = await (await req(`/threads/${thread.id}/runs`)).json();
    assert.equal(runs.length, 1);assert.equal(runs[0].status, "completed");assert.equal(runs[0].error, null);
    const history = await loadMessages(thread.id, actor());
    assert.equal(history.headId, runs[0].assistantMessageId);
    assert.match(JSON.stringify(history.messages.at(-1)?.content), /真实工具已完成，进度记录故障不影响保存回复/);
    assert.match(JSON.stringify(history.messages.at(-1)?.content), /observer-create-once/);
    const [checkpoint] = await db.select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.threadId, thread.id));
    assert(checkpoint.resumeState);assert(checkpoint.workspace?.length);
    const tables = await (await req("/tables")).json();
    assert.equal(tables.filter((table: { name: string }) => table.name === tableName).length, 1, "the real mutation executes exactly once despite failed progress inserts");
    const { events } = await (await req(`/threads/${thread.id}/runs/${runs[0].id}/events`)).json();
    assert.deepEqual(events, []);
    await assert.rejects(client.unsafe("INSERT INTO agent_run_events (run_id, activity) VALUES ($1, '{}'::jsonb)", [runs[0].id]), /fixture_progress_observer_failure/, "the thread-specific SQL fault is genuinely active");
  } finally {
    process.env.OPENROUTER_API_KEY = "";process.env.OPENROUTER_BASE_URL = previousURL ?? "";
    provider.closeAllConnections();await new Promise<void>((resolve) => provider.close(() => resolve()));
    try { await client.unsafe(`DROP TRIGGER IF EXISTS ${faultName} ON agent_run_events`); }
    finally { await client.unsafe(`DROP FUNCTION IF EXISTS ${faultName}()`); }
  }
});

test("conversation list/history/mutations are private to account and organization", async () => {
  assert.equal((await req("/threads", undefined, "GET", "")).status, 401);
  assert.equal((await req(`/threads/${threadId}`, undefined, "GET", otherCookie)).status, 404);
  assert.equal((await req(`/threads/${threadId}/messages`, undefined, "GET", otherCookie)).status, 404);
  assert.equal((await req(`/threads/${threadId}`, { title: "Wrong owner" }, "PATCH", otherCookie)).status, 404);
  assert.equal((await req(`/threads/${threadId}`, undefined, "DELETE", otherCookie)).status, 404);
  assert.deepEqual((await (await req("/threads", undefined, "GET", otherCookie)).json()).threads, []);
  const wrongScope = await req("/chat", { id: threadId, agentId, context: { page: "table", tableId }, messages: [{ id: "user-2", role: "user", parts: [{ type: "text", text: "update" }] }] });
  assert.equal(wrongScope.status, 409);
  await db.update(session).set({ activeOrganizationId: otherOrg }).where(eq(session.userId, ownerId));
  assert.equal((await req(`/threads/${threadId}`)).status, 404);
  await db.update(session).set({ activeOrganizationId: orgId }).where(eq(session.userId, ownerId));
});

test("titles survive reload; removed archive operations are rejected without hiding messages", async () => {
  await req(`/threads/${threadId}/title`, { title: "Generated" });
  await req(`/threads/${threadId}`, { title: "Manual title" }, "PATCH");
  await req(`/threads/${threadId}/title`, { title: "Do not overwrite manual" });
  assert.equal((await (await req(`/threads/${threadId}`)).json()).title, "Manual title");
  const before = await loadMessages(threadId, actor());
  assert.equal((await req(`/threads/${threadId}`, { status: "archived" }, "PATCH")).status, 400);
  assert.equal((await req(`/threads/${threadId}`, { status: "regular" }, "PATCH")).status, 400);
  const listed = await (await req("/threads")).json();
  assert.equal(listed.threads.find((thread: { id: string }) => thread.id === threadId).status, "regular");
  assert.deepEqual(await loadMessages(threadId, actor()), before);
});

test("builtin tools provide tables, forms, and automation through scoped commands", async () => {
  const tools = createTableTools(undefined, orgId, ownerId);
  const options = { toolCallId: "test", messages: [] };
  const created = await tools.create_table.execute!({ name: "Tool-created" }, options) as { id: string };
  const tableTools = createTableTools(created.id, orgId, ownerId);
  const form = await tableTools.create_form_view.execute!({ title: "Collection" }, options);
  assert(form);
  const table = await tableTools.get_table.execute!({ tableId: created.id }, options) as { columns: { id: string }[] };
  const automation = await tableTools.create_automation.execute!({ name: "New row", enabled: true, trigger: { type: "row_created" }, conditions: [], conditionLogic: "and", actions: [{ type: "update_field", columnId: table.columns[0].id, value: "Created" }] }, options) as { id: string };
  assert(automation.id);
  assert.equal((await tableTools.list_automations.execute!({}, options) as unknown[]).length, 1);
  await tableTools.delete_automation.execute!({ automationId: automation.id }, options);
  assert.equal((await tableTools.list_automations.execute!({}, options) as unknown[]).length, 0);
  await assert.rejects(tools.get_table.execute!({ tableId: foreignTableId }, options) as Promise<unknown>, /不存在/);
  await assert.rejects(tools.open_preview.execute!({ tableId: foreignTableId, kind: "table", open: true }, options) as Promise<unknown>, /不存在/);
});

test("deleting a thread removes its persisted messages", async () => {
  assert.equal((await req(`/threads/${threadId}`, undefined, "DELETE")).status, 200);
  assert.equal((await db.select().from(chatMessages).where(eq(chatMessages.threadId, threadId))).length, 0);
  assert.equal((await db.select().from(chatThreads).where(and(eq(chatThreads.id, threadId), eq(chatThreads.userId, ownerId)))).length, 0);
});

test("invalid relation calls expose field errors, reach the model for correction and survive reload", async () => {
  const customers = await createTable({ organizationId: orgId, name: "Error-recovery customers" });
  const calls: Array<{ messages: { role: string; content: unknown }[] }> = [];
  const provider = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") { response.writeHead(200, { "Content-Type": "application/json" });response.end(JSON.stringify({ data: [{ id: "openrouter/free", context_length: 200000, top_provider: { max_completion_tokens: null } }] }));return; }
    let raw = "";
    for await (const chunk of request) raw += chunk;
    calls.push(JSON.parse(raw));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const write = (delta: unknown, finish_reason: string | null) => response.write(`data: ${JSON.stringify({ id: "error-recovery", object: "chat.completion.chunk", created: 1, model: "openrouter/free", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (calls.length <= 2) {
      const first = calls.length === 1;
      const args = first
        ? { rowId: randomUUID(), columnId: "所属客户", targetTableId: customers.id, limit: "many", inverseName: "联系人", inverseLimit: "many" }
        : { tableId, name: "所属客户", type: "relation", relation: { targetTableId: customers.id, limit: "many", inverseName: "联系人", inverseLimit: "many" } };
      write({ role: "assistant", tool_calls: [{ index: 0, id: first ? "invalid-relation" : "corrected-relation", type: "function", function: { name: first ? "add_relation" : "add_column", arguments: JSON.stringify(args) } }] }, null);
      write({}, "tool_calls");
    } else {
      write({ role: "assistant", content: "已修正参数并创建双向关联字段。" }, null);
      write({}, "stop");
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address(); assert(address && typeof address !== "string");
  const previousURL = process.env.OPENROUTER_BASE_URL;
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.OPENROUTER_API_KEY = "local-test-provider";
  try {
    const thread = await (await req("/threads", { clientId: randomUUID(), context: { page: "ai" }, agentId })).json();
    const response = await req("/chat", { id: thread.id, agentId, context: { page: "ai" }, messages: [{ id: "relation-error-user", role: "user", parts: [{ type: "text", text: "建立联系人和客户双向关联" }] }] });
    assert.equal(response.status, 200);
    const stream = await response.text();
    assert.match(stream, /columnId：必须是 UUID/);
    assert.match(stream, /recordIds：缺少必填参数/);
    assert.match(stream, /不支持这些参数/);
    assert.match(stream, /创建关联字段请使用 add_column/);
    assert(!stream.includes("An error occurred."));
    assert.equal(calls.length, 3);
    // The next model step sees why validation failed and can choose the correct tool.
    const modelError = JSON.stringify(calls[1].messages.filter((m) => m.role === "tool"));
    assert.match(modelError, /columnId/); assert.match(modelError, /recordIds/); assert.match(modelError, /uuid/i);
    const { getTable } = await import("../../src/commands/index.js");
    const source = await getTable({ tableId, organizationId: orgId });
    const target = await getTable({ tableId: customers.id, organizationId: orgId });
    const col = source.columns.find((c) => c.name === "所属客户");
    assert(col?.config.relation?.relationId);
    assert.equal(target.columns.find((c) => c.name === "联系人")?.config.relation?.relationId, col.config.relation.relationId);
    const restored = await (await req(`/threads/${thread.id}/messages`)).json();
    const parts = restored.messages.find((m: { content: { role: string } }) => m.content.role === "assistant").content.parts;
    const errorPart = parts.find((p: { toolCallId: string }) => p.toolCallId === "invalid-relation");
    assert.equal(errorPart.state, "output-error");
    assert.match(errorPart.errorText, /columnId：必须是 UUID/);
    assert.match(errorPart.errorText, /recordIds：缺少必填参数/);
    assert(parts.some((p: { toolCallId: string; state: string }) => p.toolCallId === "corrected-relation" && p.state === "output-available"));
    assert.equal(typeof parts.find((p: { toolCallId: string }) => p.toolCallId === "corrected-relation").output.createdAt, "string");
    assert.equal((stream.match(/"type":"data-table-mutated"/g) ?? []).length, 1);
  } finally {
    process.env.OPENROUTER_API_KEY = "";
    process.env.OPENROUTER_BASE_URL = previousURL ?? "";
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});

test("native persona policy updates survive new turns and generate internal AGENTS.md", { timeout: 20_000 }, async () => {
  const policy = "Policy-fixture-before: read saved results before completion.";
  assert.equal((await req(`/members/agents/${agentId}`, { persona: { systemPrompt: policy } }, "PATCH")).status, 200);
  const name = `Task-${randomUUID()}`;
  const calls: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  const operations = [
    { tool: "create_table", args: { name } },
    null,
    { tool: "list_tables", args: {} },
    null,
  ];
  const provider = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") { response.writeHead(200, { "Content-Type": "application/json" });response.end(JSON.stringify({ data: [{ id: "openrouter/free", context_length: 200000, top_provider: { max_completion_tokens: null } }] }));return; }
    let raw = ""; for await (const chunk of request) raw += chunk;
    calls.push(JSON.parse(raw));
    const operation = operations[calls.length - 1];
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const write = (delta: unknown, finish_reason: string | null) => response.write(`data: ${JSON.stringify({ id: "tasks", object: "chat.completion.chunk", created: 1, model: "openrouter/free", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (operation) {
      write({ role: "assistant", tool_calls: [{ index: 0, id: `task-call-${calls.length}`, type: "function", function: { name: operation.tool, arguments: JSON.stringify(operation.args) } }] }, null);
      write({}, "tool_calls");
    } else { write({ role: "assistant", content: calls.length === 2 ? "表格已创建，下一轮核对结果。" : "已核对保存结果。" }, null); write({}, "stop"); }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address(); assert(address && typeof address !== "string");
  const previousURL = process.env.OPENROUTER_BASE_URL;
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.OPENROUTER_API_KEY = "local-test-provider";
  try {
    const thread = await (await req("/threads", { clientId: randomUUID(), context: { page: "ai" }, agentId })).json();
    const first = await req("/chat", { id: thread.id, agentId, context: { page: "ai" }, messages: [{ id: "tasks-user-1", role: "user", parts: [{ type: "text", text: "先创建表格，下一轮再验证" }] }] });
    assert.equal(first.status, 200);
    const stream = await first.text();
    assert.match(stream, /表格已创建/);
    assert(!stream.includes('"state":"output-error"'));
    assert.equal((stream.match(/"type":"data-table-mutated"/g) ?? []).length, 1);
    assert.equal((await req(`/threads/${thread.id}/task-state`)).status, 404, "retired custom task endpoint is absent");
    assert.equal((await (await req(`/threads/${thread.id}/runs`)).json()).runs[0].status, "completed");
    assert.match(JSON.stringify(calls[0].messages), /Policy-fixture-before/);
    const updatedPolicy = "Policy-fixture-after: verify table ownership before completing.";
    assert.equal((await req(`/members/agents/${agentId}`, { persona: { systemPrompt: updatedPolicy } }, "PATCH")).status, 200);
    const history = await loadMessages(thread.id, actor());
    const messages = history.messages.map((message) => ({ id: message.id, ...message.content }));
    const second = await req("/chat", { id: thread.id, agentId, context: { page: "ai" }, messages: [...messages, { id: "tasks-user-2", role: "user", parts: [{ type: "text", text: "核对已保存表格" }] }] });
    assert.equal(second.status, 200);
    const secondStream = await second.text();
    assert.match(secondStream, /已核对保存结果/);
    assert(!secondStream.includes("data-table-mutated"));
    assert.equal(calls.length, 4);
    assert.match(JSON.stringify(calls[2].messages.filter((message) => message.role === "system")), /Policy-fixture-after/);
    const [checkpoint] = await db.select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.threadId, thread.id));
    const policyFile = checkpoint.workspace?.find((entry) => entry.path === "/workspace/agent/AGENTS.md");
    assert(policyFile?.type === "file" && typeof policyFile.content === "string"); assert.match(Buffer.from(policyFile.content, "base64").toString("utf8"), /Policy-fixture-after/);
  } finally {
    process.env.OPENROUTER_API_KEY = ""; process.env.OPENROUTER_BASE_URL = previousURL ?? "";
    provider.closeAllConnections(); await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});

for (const stop of ["cancel", "timeout", "first-output", "step", "chunk"] as const) test(`native run ${stop} stops a waiting model, checkpoints the result and never repeats the completed mutation`, { timeout: 15_000 }, async () => {
  let requests = 0, reachedSecond!: () => void;
  const waiting = new Promise<void>((resolve) => { reachedSecond = resolve; });
  const tableName = `Cancellation-${randomUUID()}`;
  const provider = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") { response.writeHead(200, { "Content-Type": "application/json" });response.end(JSON.stringify({ data: [{ id: "openrouter/free", context_length: 200000, top_provider: { max_completion_tokens: null } }] }));return; }
    for await (const _chunk of request) { /* drain the request body */ }
    requests++;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    if (requests === 1) {
      const delta = { role: "assistant", tool_calls: [{ index: 0, id: "cancel-create", type: "function", function: { name: "create_table", arguments: JSON.stringify({ name: tableName }) } }] };
      for (const [value, finish_reason] of [[delta, null], [{}, "tool_calls"]]) response.write(`data: ${JSON.stringify({ id: "cancel-test", object: "chat.completion.chunk", created: 1, model: "openrouter/free", choices: [{ index: 0, delta: value, finish_reason }] })}\n\n`);
      response.end("data: [DONE]\n\n");
    } else {
      if (stop === "chunk") response.write(`data: ${JSON.stringify({ id: "cancel-test", object: "chat.completion.chunk", created: 1, model: "openrouter/free", choices: [{ index: 0, delta: { role: "assistant", content: "部分回复" }, finish_reason: null }] })}\n\n`);
      response.flushHeaders();
      reachedSecond(); // Model stalls after a successful host mutation.
    }
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address(); assert(address && typeof address !== "string");
  const previousURL = process.env.OPENROUTER_BASE_URL, previousPoll = process.env.AI_RUN_POLL_MS, previousTotal = process.env.AI_CHAT_TOTAL_MS;
  const limitNames = ["AI_CHAT_FIRST_CHUNK_MS", "AI_CHAT_STEP_MS", "AI_CHAT_CHUNK_MS"];
  const previousLimits = Object.fromEntries(limitNames.map((name) => [name, process.env[name]]));
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.OPENROUTER_API_KEY = "local-test-provider"; process.env.AI_RUN_POLL_MS = "200";
  if (stop === "timeout") process.env.AI_CHAT_TOTAL_MS = "1000";
  if (["first-output", "step", "chunk"].includes(stop)) process.env.AI_CHAT_TOTAL_MS = "3000";
  if (stop === "first-output") process.env.AI_CHAT_FIRST_CHUNK_MS = "350";
  if (stop === "step") process.env.AI_CHAT_STEP_MS = "350";
  if (stop === "chunk") process.env.AI_CHAT_CHUNK_MS = "350";
  try {
    const thread = await (await req("/threads", { clientId: randomUUID(), context: { page: "ai" }, agentId })).json();
    const response = await req("/chat", { id: thread.id, agentId, context: { page: "ai" }, messages: [{ id: "cancel-user", role: "user", parts: [{ type: "text", text: "创建表格后继续说明" }] }] });
    assert.equal(response.status, 200);
    const completion = response.text();
    await waiting;
    const active = await (await req(`/threads/${thread.id}/runs`)).json();
    assert.equal(active.runs[0].status, "running");
    assert.equal((await req(`/threads/${thread.id}`, undefined, "DELETE")).status, 409);
    const concurrent = await req("/chat", { id: thread.id, agentId, context: { page: "ai" }, messages: [{ id: "concurrent-user", role: "user", parts: [{ type: "text", text: "另外一个请求" }] }] });
    assert.equal(concurrent.status, 409); assert.match(await concurrent.text(), /正在运行/);
    if (stop === "cancel") assert.equal((await req(`/threads/${thread.id}/runs/${active.runs[0].id}/cancel`, {})).status, 200);
    const stream = await completion;
    const explanation = stop === "cancel" ? /已停止执行/ : stop === "first-output" ? /模型首个输出等待超时/ : stop === "step" ? /本轮步骤执行超时/ : stop === "chunk" ? /模型输出流超时/ : /本轮执行超时/;
    assert.match(stream, explanation);
    const finished = await (await req(`/threads/${thread.id}/runs`)).json();
    assert.equal(finished.runs[0].status, stop === "cancel" ? "cancelled" : "failed");
    const history = await loadMessages(thread.id, actor());
    assert.equal(history.messages.length, 2);
    assert.match(JSON.stringify(history.messages[1].content), explanation);
    if (stop === "chunk") assert.match(JSON.stringify(history.messages[1].content), /部分回复/);
    assert.match(JSON.stringify(history.messages[1].content), /cancel-create/);
    const [checkpoint] = await db.select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.threadId, thread.id));
    assert(checkpoint.resumeState); assert(checkpoint.workspace?.some((entry) => entry.path.endsWith(".jsonl")));
    assert.equal(checkpoint.lastAssistantMessageId, history.headId);
    const tables = await (await req("/tables")).json();
    assert.equal(tables.filter((table: { name: string }) => table.name === tableName).length, 1);
    assert.equal(requests, 2);
  } finally {
    process.env.OPENROUTER_API_KEY = ""; process.env.OPENROUTER_BASE_URL = previousURL ?? "";
    if (previousPoll === undefined) delete process.env.AI_RUN_POLL_MS; else process.env.AI_RUN_POLL_MS = previousPoll;
    if (previousTotal === undefined) delete process.env.AI_CHAT_TOTAL_MS; else process.env.AI_CHAT_TOTAL_MS = previousTotal;
    for (const [name, value] of Object.entries(previousLimits)) { if (value === undefined) delete process.env[name];else process.env[name] = value; }
    provider.closeAllConnections(); await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});

test("native step limit suspends a turn and ordinary follow-up officially resumes without replaying tools", { timeout: 15_000 }, async () => {
  let requests = 0, continuing = false;
  const nativeRequests: { messages: { role: string; content: unknown }[] }[] = [];
  const tableName = `Continuation-${randomUUID()}`;
  const provider = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") { response.writeHead(200, { "Content-Type": "application/json" });response.end(JSON.stringify({ data: [{ id: "openrouter/free", context_length: 200000, top_provider: { max_completion_tokens: null } }] }));return; }
    let raw = "";for await (const chunk of request) raw += chunk;
    nativeRequests.push(JSON.parse(raw));
    requests++;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const write = (delta: unknown, finish_reason: string | null) => response.write(`data: ${JSON.stringify({ id: "continue-test", object: "chat.completion.chunk", created: 1, model: "openrouter/free", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (requests <= 2) {
      write({ role: "assistant", tool_calls: [{ index: 0, id: `continue-tool-${requests}`, type: "function", function: { name: requests === 1 ? "create_table" : "list_tables", arguments: requests === 1 ? JSON.stringify({ name: tableName }) : "{}" } }] }, null);
      write({}, "tool_calls");
    } else if (continuing) { write({ role: "assistant", content: "继续执行完成，已有工具无需再次执行。" }, null);write({}, "stop"); }
    else { write({ role: "assistant", content: "等待暂停边界" }, null);response.flushHeaders();return; } // SDK evaluates the semantic stop on the next native event.
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address(); assert(address && typeof address !== "string");
  const previousURL = process.env.OPENROUTER_BASE_URL, previousSteps = process.env.AI_CHAT_MAX_STEPS;
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${address.port}/v1`; process.env.OPENROUTER_API_KEY = "local-test-provider";process.env.AI_CHAT_MAX_STEPS = "2";
  try {
    const thread = await (await req("/threads", { clientId: randomUUID(), context: { page: "ai" }, agentId })).json();
    const initialUser = { id: "continue-user-1", role: "user", parts: [{ type: "text", text: "创建并列出表格，然后说明结果" }] };
    const initial = await req("/chat", { id: thread.id, agentId, context: { page: "ai" }, messages: [initialUser] });
    assert.equal(initial.status, 200);const pausedStream = await initial.text();
    assert(!pausedStream.includes("达到配置的 2 步上限") && !pausedStream.includes("本轮已暂停") && !pausedStream.includes('"id":"run-note"'), "native suspension does not synthesize assistant text");
    const pausedRequests = requests;assert(pausedRequests >= 2 && pausedRequests <= 3);
    const history = await loadMessages(thread.id, actor());
    const before = await (await req(`/threads/${thread.id}/runs`)).json();assert.equal(before.runs[0].status, "suspended");
    assert.equal(before.runs[0].canContinue, true);
    const [checkpoint] = await db.select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.threadId, thread.id));assert(checkpoint.resumeState?.continueFrom);
    const reply = { id: history.headId, ...history.messages[1].content };
    continuing = true;
    const followUp = "请补充刚才表格的查询结果，并说明统计口径";
    const resumed = await req("/chat", { id: thread.id, agentId, context: { page: "ai" }, messages: [initialUser, reply, { id: "continue-user-2", role: "user", parts: [{ type: "text", text: followUp }] }] });
    assert.equal(resumed.status, 200);assert.match(await resumed.text(), /继续执行完成/);assert.equal(requests, pausedRequests + 1);
    const nativeUsers = nativeRequests.at(-1)!.messages.filter((message) => message.role === "user");
    assert(JSON.stringify(nativeUsers.at(-1)?.content).includes(followUp), `ordinary follow-up is passed to the native provider rather than discarded: ${JSON.stringify(nativeUsers)}`);
    assert(JSON.stringify(nativeRequests.at(-1)).includes(tableName));
    const after = await (await req(`/threads/${thread.id}/runs`)).json();assert.equal(after.runs[0].status, "completed");assert.equal(after.runs.length, 2);
    assert(after.runs.every((run: { canContinue: boolean }) => !run.canContinue));
    const tables = await (await req("/tables")).json();assert.equal(tables.filter((table: { name: string }) => table.name === tableName).length, 1);
    assert.equal((await loadMessages(thread.id, actor())).messages.length, 4);
  } finally {
    process.env.OPENROUTER_API_KEY = "";process.env.OPENROUTER_BASE_URL = previousURL ?? "";
    if (previousSteps === undefined) delete process.env.AI_CHAT_MAX_STEPS;else process.env.AI_CHAT_MAX_STEPS = previousSteps;
    provider.closeAllConnections();await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});

test("default native tool loop completes seventeen tool steps without a hidden pause", { timeout: 20_000 }, async () => {
  const calls: { messages: { role: string; content: unknown }[] }[] = [];
  const provider = createServer(async (request, response) => {
    if (request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "openrouter/free", context_length: 200000, top_provider: { max_completion_tokens: null } }] }));return;
    }
    let raw = "";for await (const chunk of request) raw += chunk;
    calls.push(JSON.parse(raw));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const write = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "unbounded-steps", object: "chat.completion.chunk", created: 1, model: "openrouter/free", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    write({ role: "assistant" });
    if (calls.length <= 17) {
      write({ tool_calls: [{ index: 0, id: `unbounded-${calls.length}`, type: "function", function: { name: "list_tables", arguments: "{}" } }] });write({}, "tool_calls");
    } else { write({ content: "十七次真实工具查询已完成，没有隐藏的步骤暂停。" });write({}, "stop"); }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();assert(address && typeof address !== "string");
  const previousURL = process.env.OPENROUTER_BASE_URL, previousSteps = process.env.AI_CHAT_MAX_STEPS;
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${address.port}/v1`;process.env.OPENROUTER_API_KEY = "local-unbounded-provider";
  delete process.env.AI_CHAT_MAX_STEPS;
  try {
    const thread = await (await req("/threads", { clientId: randomUUID(), context: { page: "ai" }, agentId })).json();
    const response = await req("/chat", { id: thread.id, agentId, context: { page: "ai" }, messages: [{ id: "unbounded-user", role: "user", parts: [{ type: "text", text: "连续核对十七次表格目录，再说明完成情况" }] }] });
    assert.equal(response.status, 200);const stream = await response.text();
    assert.match(stream, /十七次真实工具查询已完成/);assert(!stream.includes("本轮已暂停"));
    assert.equal(calls.length, 18, "seventeen actual tool round trips reach the final text request");
    assert.equal(calls.at(-1)!.messages.filter((message) => message.role === "tool").length, 17);
    assert(stream.includes('"completedTools":17'), "all seventeen tool executions completed successfully");
    const runs = await (await req(`/threads/${thread.id}/runs`)).json();
    assert.equal(runs.runs[0].status, "completed");assert.equal(runs.runs[0].canContinue, false);
    const [checkpoint] = await db.select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.threadId, thread.id));
    assert(checkpoint.resumeState);assert(!checkpoint.resumeState.continueFrom);
  } finally {
    process.env.OPENROUTER_API_KEY = "";process.env.OPENROUTER_BASE_URL = previousURL ?? "";
    if (previousSteps === undefined) delete process.env.AI_CHAT_MAX_STEPS;else process.env.AI_CHAT_MAX_STEPS = previousSteps;
    provider.closeAllConnections();await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});

test("Pi keeps a real output budget for long context and reports actual length endings as output-limit failures", async () => {
  const budgets: number[] = [];
  const provider = createServer(async (request, response) => {
    if (request.method === "GET") { response.writeHead(200, { "Content-Type": "application/json" });response.end(JSON.stringify({ data: [{ id: "openrouter/free", context_length: 200000, top_provider: { max_completion_tokens: null } }] }));return; }
    let raw = "";for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);budgets.push(body.max_tokens ?? body.max_completion_tokens);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const write = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "budget-regression", object: "chat.completion.chunk", created: 1, model: "openrouter/free", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (budgets.length === 1) {
      write({ role: "assistant", tool_calls: [{ index: 0, id: "budget-table", type: "function", function: { name: "get_table", arguments: JSON.stringify({ tableId }) } }] });write({}, "tool_calls");
    } else if (budgets.length === 2) { write({ role: "assistant", content: "长上下文工具执行后仍有完整回复。" });write({}, "stop"); }
    else { write({ role: "assistant", reasoning: "I" });write({}, "length"); }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();assert(address && typeof address !== "string");
  const previousURL = process.env.OPENROUTER_BASE_URL, previousBudget = process.env.PI_MAX_OUTPUT_TOKENS;
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${address.port}/v1`;process.env.OPENROUTER_API_KEY = "local-test-provider";process.env.PI_MAX_OUTPUT_TOKENS = "8192";
  try {
    const thread = await (await req("/threads", { clientId: randomUUID(), context: { page: "ai" }, agentId })).json();
    const first = { id: "budget-user-1", role: "user", parts: [{ type: "text", text: "context ".repeat(16000) + "查看表格并说明结果" }] };
    const response = await req("/chat", { id: thread.id, agentId, context: { page: "ai" }, messages: [first] });
    assert.equal(response.status, 200);assert.match(await response.text(), /长上下文工具执行后仍有完整回复/);
    assert.deepEqual(budgets, [8192, 8192], "native SDK must not clamp a long context to a one-token reply");
    const history = await loadMessages(thread.id, actor());
    const second = await req("/chat", { id: thread.id, agentId, context: { page: "ai" }, messages: [first, { id: history.headId, ...history.messages[1].content }, { id: "budget-user-2", role: "user", parts: [{ type: "text", text: "继续说明" }] }] });
    assert.match(await second.text(), /系统提示：.*模型输出上限/);
    const runs = (await (await req(`/threads/${thread.id}/runs`)).json()).runs;
    assert.equal(runs[0].status, "failed");assert.match(runs[0].error, /输出上限/);assert.equal(runs[1].status, "completed");
    assert.equal(budgets[2], 8192);
    const persisted = await loadMessages(thread.id, actor());assert.match(JSON.stringify(persisted.messages.at(-1)?.content), /模型输出上限/);
  } finally {
    process.env.OPENROUTER_API_KEY = "";process.env.OPENROUTER_BASE_URL = previousURL ?? "";
    if (previousBudget === undefined) delete process.env.PI_MAX_OUTPUT_TOKENS;else process.env.PI_MAX_OUTPUT_TOKENS = previousBudget;
    provider.closeAllConnections();await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});

test("natural empty stop completes with real tool results and a new input does not replay the tool", { timeout: 15_000 }, async () => {
  const calls: { messages: { role: string; content: unknown }[] }[] = [];
  const tableName = `Empty-stop-${randomUUID()}`;
  const provider = createServer(async (request, response) => {
    if (request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "openrouter/free", context_length: 200000, top_provider: { max_completion_tokens: null } }] }));return;
    }
    let raw = "";for await (const chunk of request) raw += chunk;
    calls.push(JSON.parse(raw));response.writeHead(200, { "Content-Type": "text/event-stream" });
    const write = (delta: unknown, finish_reason: string | null = null, usage?: unknown) => response.write(`data: ${JSON.stringify({ id: "empty-stop", object: "chat.completion.chunk", created: 1, model: "openrouter/free", choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`);
    write({ role: "assistant" });
    if (calls.length === 1) {
      write({ tool_calls: [{ index: 0, id: "empty-stop-create", type: "function", function: { name: "create_table", arguments: JSON.stringify({ name: tableName }) } }] });write({}, "tool_calls");
    } else if (calls.length === 2) {
      write({ reasoning_content: "The actual tool result has been verified." });
      write({}, "stop", { prompt_tokens: 100, completion_tokens: 12, total_tokens: 112, completion_tokens_details: { reasoning_tokens: 12 } });
    } else { write({ content: "沿用已保存的表格，补充说明。" });write({}, "stop"); }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();assert(address && typeof address !== "string");
  const previousURL = process.env.OPENROUTER_BASE_URL;
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${address.port}/v1`;process.env.OPENROUTER_API_KEY = "local-empty-stop-provider";
  try {
    const thread = await (await req("/threads", { clientId: randomUUID(), context: { page: "ai" }, agentId })).json();
    const initialUser = { id: "empty-stop-user-1", role: "user", parts: [{ type: "text", text: "创建表格并核对真实结果" }] };
    const first = await req("/chat", { id: thread.id, agentId, context: { page: "ai" }, messages: [initialUser] });
    assert.equal(first.status, 200);const stream = await first.text();
    assert.equal(calls.length, 2);assert(stream.includes('"toolCallId":"empty-stop-create"'));
    assert(!stream.includes('"type":"text-delta"'), "natural stop without prose receives no platform summary");
    assert(!stream.includes("未返回正文") && !stream.includes("系统提示") && !stream.includes("本轮未完成"));
    const firstRuns = await (await req(`/threads/${thread.id}/runs`)).json();
    assert.equal(firstRuns.runs[0].status, "completed");assert.equal(firstRuns.runs[0].error, null);assert.equal(firstRuns.runs[0].canContinue, false);
    const history = await loadMessages(thread.id, actor()), assistant = history.messages.at(-1)!;
    const persistedParts: unknown = assistant.content.parts;
    assert(Array.isArray(persistedParts), "durable assistant has native message parts");
    const parts = persistedParts as { type: string; state?: string }[];
    assert(!parts.some((part) => part.type === "text"), "durable assistant preserves tools/reasoning without synthetic prose");
    assert(parts.some((part) => part.type === "tool-create_table" && part.state === "output-available"));
    const [checkpoint] = await db.select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.threadId, thread.id));
    assert(checkpoint.resumeState);assert(!checkpoint.resumeState.continueFrom);
    const followUp = "请解释刚才已保存表格的用途，不要再次创建";
    const next = await req("/chat", { id: thread.id, agentId, context: { page: "ai" }, messages: [...history.messages.map((message) => ({ id: message.id, ...message.content })), { id: "empty-stop-user-2", role: "user", parts: [{ type: "text", text: followUp }] }] });
    assert.equal(next.status, 200);assert.match(await next.text(), /沿用已保存的表格/);assert.equal(calls.length, 3);
    assert(JSON.stringify(calls[2].messages).includes(tableName));
    assert(JSON.stringify(calls[2].messages.filter((message) => message.role === "user").at(-1)?.content).includes(followUp));
    const tables = await (await req("/tables")).json();
    assert.equal(tables.filter((table: { name: string }) => table.name === tableName).length, 1, "the committed tool is not replayed after an empty stop");
    const runs = await (await req(`/threads/${thread.id}/runs`)).json();
    assert.equal(runs.runs.length, 2);assert(runs.runs.every((run: { status: string }) => run.status === "completed"));
  } finally {
    process.env.OPENROUTER_API_KEY = "";process.env.OPENROUTER_BASE_URL = previousURL ?? "";
    provider.closeAllConnections();await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});

test("tool execution failures keep business reasons in the stream, model step and persisted history", async () => {
  const calls: Array<{ messages: { role: string; content: unknown }[] }> = [];
  const provider = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") { response.writeHead(200, { "Content-Type": "application/json" });response.end(JSON.stringify({ data: [{ id: "openrouter/free", context_length: 200000, top_provider: { max_completion_tokens: null } }] }));return; }
    let raw = "";
    for await (const chunk of request) raw += chunk;
    calls.push(JSON.parse(raw));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const write = (delta: unknown, finish_reason: string | null) => response.write(`data: ${JSON.stringify({ id: "execution-error", object: "chat.completion.chunk", created: 1, model: "openrouter/free", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (calls.length === 1) {
      write({ role: "assistant", tool_calls: [{ index: 0, id: "missing-table", type: "function", function: { name: "get_table", arguments: JSON.stringify({ tableId: foreignTableId }) } }] }, null);
      write({}, "tool_calls");
    } else {
      write({ role: "assistant", content: "无法读取这张表，请检查工作区及表格 ID。" }, null);
      write({}, "stop");
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address(); assert(address && typeof address !== "string");
  const previousURL = process.env.OPENROUTER_BASE_URL;
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.OPENROUTER_API_KEY = "local-test-provider";
  try {
    const thread = await (await req("/threads", { clientId: randomUUID(), context: { page: "ai" }, agentId })).json();
    const response = await req("/chat", { id: thread.id, agentId, context: { page: "ai" }, messages: [{ id: "business-error-user", role: "user", parts: [{ type: "text", text: "读取表格" }] }] });
    const stream = await response.text();
    assert.match(stream, /表格不存在/); assert(!stream.includes("An error occurred."));
    assert.equal(calls.length, 2);
    assert.match(JSON.stringify(calls[1].messages.filter((m) => m.role === "tool")), /表格不存在/);
    const restored = await (await req(`/threads/${thread.id}/messages`)).json();
    const parts = restored.messages.find((m: { content: { role: string } }) => m.content.role === "assistant").content.parts;
    assert.match(parts.find((p: { toolCallId: string }) => p.toolCallId === "missing-table").errorText, /表格不存在/);
    assert(!stream.includes('"type":"data-table-mutated"'));
  } finally {
    process.env.OPENROUTER_API_KEY = "";
    process.env.OPENROUTER_BASE_URL = previousURL ?? "";
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});

test("chat normalizes legacy native/task settings while disabled platform calls still persist errors", async () => {
  const calls: Array<{ tools?: { function: { name: string } }[]; messages: { role: string; content: unknown }[] }> = [];
  const provider = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "openrouter/free", context_length: 200000, top_provider: { max_completion_tokens: null } }] })); return;
    }
    let raw = ""; for await (const chunk of request) raw += chunk;
    calls.push(JSON.parse(raw)); response.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "disabled-tools", object: "chat.completion.chunk", created: 1, model: "openrouter/free", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send({ role: "assistant" });
    if (calls.length === 1) {
      send({ tool_calls: [
        { index: 0, id: "disabled-create-table", type: "function", function: { name: "create_table", arguments: JSON.stringify({ name: "Must not exist" }) } },
        { index: 1, id: "disabled-plan", type: "function", function: { name: "update_plan", arguments: JSON.stringify({ steps: [{ text: "Must not persist", status: "in_progress" }] }) } },
      ] }); send({}, "tool_calls");
    } else { send({ content: "工具已关闭，未修改数据或计划。" }); send({}, "stop"); }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address(); assert(address && typeof address !== "string");
  process.env.OPENROUTER_API_KEY = "tool-settings-test";
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  try {
    // Simulate an untouched old profile rather than the already-normalizing PATCH.
    const [profile] = await db.select().from(agentProfile).where(eq(agentProfile.userId, agentUserId));
    await db.update(agentProfile).set({ persona: { ...profile.persona, disabledTools: ["create_table", "update_plan", "bash", "read"] } }).where(eq(agentProfile.id, profile.id));
    const beforeTables = await (await req("/tables")).json();
    const thread = await (await req("/threads", { clientId: randomUUID(), context: { page: "ai" }, agentId })).json();
    const response = await req("/chat", { id: thread.id, agentId, context: { page: "ai" }, messages: [{ id: "disabled-tools-user", role: "user", parts: [{ type: "text", text: "确认工具开关" }] }] });
    assert.equal(response.status, 200);
    const stream = await response.text();
    assert(!stream.includes('"type":"data-table-mutated"'));
    assert.match(stream, /tool-output-error/);
    const sent = calls[0].tools?.map(item => item.function.name) ?? [];
    for (const id of ["create_table", "update_plan", "create_goal", "update_goal", "get_task_state"]) assert(!sent.includes(id), `${id} absent from real chat provider catalog`);
    for (const id of ["get_table", "bash", "read", "askUserQuestions"]) assert(sent.includes(id));
    assert.match(JSON.stringify(calls[1].messages), /Tool create_table not found/);
    assert.deepEqual(await (await req("/tables")).json(), beforeTables);
    const history = await (await req(`/threads/${thread.id}/messages`)).json();
    const parts = history.messages.flatMap((message: { content: { parts: Array<{type:string;state?:string}> } }) => message.content.parts);
    assert.equal(parts.filter((part: {type:string;state?:string}) => part.type === "tool-create_table" && part.state === "output-error").length, 1);
    assert.match(JSON.stringify(calls[1].messages), /Tool update_plan not found/, "retired tools have no execution implementation");
  } finally {
    await req(`/members/agents/${agentId}`, { persona: { disabledTools: [] } }, "PATCH");
    process.env.OPENROUTER_API_KEY = ""; process.env.OPENROUTER_BASE_URL = "";
    await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
  }
});
