import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { createTestHarness } from "wrangler";
import { createDatabase } from "@tabdo/backend/database";
import { tables, columns, rows, agentExecutions, agentExecutionChunks, agentRuns, agentRuntimeSessions, agentProfile, chatThreads, member, organization, user, userApiKeys } from "@tabdo/backend/schema";

const connectionString = process.env.DATABASE_URL ?? "";
if (!connectionString || !new URL(connectionString).pathname.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");

test("shared command and session services run in Workers with Better Auth, atomic PG writes and private cancellation", { timeout: 60000 }, async () => {
  const database = createDatabase({ connectionString, poolMax: 2 });
  const config = JSON.parse(await readFile(new URL("./fixture/platform-wrangler.jsonc", import.meta.url), "utf8"));
  config.hyperdrive[0].localConnectionString = connectionString;
  const server = createTestHarness({ root: fileURLToPath(new URL("./fixture/", import.meta.url)), workers: [{ config }] });
  const orgId = randomUUID();
  const agentUser = randomUUID();
  const accounts: string[] = [];
  const apiKey = `tab_${randomBytes(32).toString("base64url")}`;
  try {
    await server.listen();
    async function signup(name: string) {
      const response = await server.fetch("/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173" }, body: JSON.stringify({ name, email: `cf-session-${randomUUID()}@example.test`, password: "Fixture-password-123!" }) });
      assert.equal(response.status, 200, await response.clone().text());
      const result = await response.json() as { user: { id: string } };
      accounts.push(result.user.id);
      return { id: result.user.id, cookie: response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
    }
    const owner = await signup("Coordinator owner");
    const teammate = await signup("Other workspace member");
    await database.db.insert(user).values({ id: agentUser, name: "Fixture agent", email: `${agentUser}@example.test`, kind: "agent" });
    await database.db.insert(organization).values({ id: orgId, name: "Platform coordinator fixture", slug: orgId });
    const ownerMember = randomUUID(), agentMember = randomUUID();
    await database.db.insert(member).values([{ id: ownerMember, userId: owner.id, organizationId: orgId, role: "owner" },
      { id: randomUUID(), userId: teammate.id, organizationId: orgId, role: "member" }, { id: agentMember, userId: agentUser, organizationId: orgId, role: "member" }]);
    await database.db.insert(userApiKeys).values({ userId: owner.id, organizationId: orgId, name: "Workerd fixture", prefix: apiKey.slice(0,12), keyHash: createHash("sha256").update(apiKey).digest("hex") });
    const [table] = await database.db.insert(tables).values({ organizationId: orgId, name: "Worker command fixture" }).returning();
    const [title] = await database.db.insert(columns).values({ tableId: table.id, name: "Title", type: "text" }).returning();
    async function command(name: string, input: Record<string, unknown> = {}, authorization = `Bearer ${apiKey}`) {
      return server.fetch("/api/commands", { method: "POST", headers: { "content-type": "application/json", authorization }, body: JSON.stringify({ command: name, input }) });
    }
    assert.equal((await command("listTables", {}, "")).status, 401);
    const listed = await command("listTables", { organizationId: randomUUID() });
    assert.equal(listed.status, 200);
    assert.equal((await listed.json() as { result: { id: string }[] }).result[0].id, table.id, "actor workspace overrides payload scope");
    const memberList = await command("listMembers", { kind: "agent" });
    assert.equal(memberList.status, 200, await memberList.clone().text());
    assert.equal((await memberList.json() as { result: { members: { userId: string }[] } }).result.members[0].userId, agentUser);
    assert.equal((await command("addRow", { tableId: table.id, skipAutomation: true })).status, 400);
    assert.equal((await command("addRow", { tableId: table.id, actorId: teammate.id })).status, 400);
    assert.equal((await command("prepareBatchRowWrites", {})).status, 400, "internal module exports are not public commands");
    const added = await command("batchAddRows", { tableId: table.id, rows: [{ cells: { [title.id]: "First" } }, { cells: { [title.id]: "Second" } }] });
    assert.equal(added.status, 200, await added.clone().text());
    assert.equal((await added.json() as { result: { count: number } }).result.count, 2);
    const storedRows = await database.db.select().from(rows).where(eq(rows.tableId, table.id));
    assert.equal(storedRows.length, 2, "Worker HTTP executes actual backend transaction");
    const duplicateColumn = await command("batchAddColumns", { tableId: table.id, columns: [{ name: "Duplicate", type: "text" }, { name: "Duplicate", type: "text" }] });
    assert.equal(duplicateColumn.status, 409, await duplicateColumn.clone().text());
    assert.equal((await database.db.select().from(columns).where(eq(columns.tableId, table.id))).length, 1, "unique violation rolls back whole batch");
    const [profile] = await database.db.insert(agentProfile).values({ userId: agentUser, organizationId: orgId, memberId: agentMember, displayName: "Fixture agent" }).returning();
    const [thread] = await database.db.insert(chatThreads).values({ userId: owner.id, organizationId: orgId, clientId: randomUUID() }).returning();
    const [record] = await database.db.insert(agentRuntimeSessions).values({ threadId: thread.id, agentProfileId: profile.id, harness: "pi", mode: "local", sandboxId: randomUUID() }).returning();
    const [run] = await database.db.insert(agentRuns).values({ threadId: thread.id, runtimeSessionId: record.id, userMessageId: randomUUID(), assistantMessageId: randomUUID(), fence: 1, status: "running" }).returning();
    const [execution] = await database.db.insert(agentExecutions).values({ runId: run.id, fence: 1, leaseToken: randomUUID(), input: { protocol: 1, context: { page: "ai" }, prompt: "Fixture accepted input" }, status: "settled", lastCursor: 5 }).returning();
    const chunks = [{ type: "start", messageId: run.assistantMessageId }, { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", delta: "Persisted platform output" }, { type: "text-end", id: "text" }, { type: "finish", finishReason: "stop" }];
    await database.db.insert(agentExecutionChunks).values(chunks.map((chunk, index) => ({ executionId: execution.id, cursor: index+1, chunk })));
    const reference = { executionId: execution.id, runId: run.id, threadId: thread.id };
    const query = new URLSearchParams(reference).toString();
    assert.equal((await server.fetch(`/stream?${query}`)).status, 401);
    assert.equal((await server.fetch(`/stream?${query}`, { headers: { cookie: teammate.cookie } })).status, 404, "same workspace does not grant private thread access");
    const wrong = new URLSearchParams({ ...reference, threadId: randomUUID() }).toString();
    assert.equal((await server.fetch(`/stream?${wrong}`, { headers: { cookie: owner.cookie } })).status, 404, "all private reference fields match the durable execution");
    const response = await server.fetch(`/stream?${query}`, { headers: { cookie: owner.cookie } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-vercel-ai-ui-message-stream"), "v1");
    const text = await response.text();
    assert(text.includes("Persisted platform output"));
    assert(text.includes("data: [DONE]"));
    assert.equal(text.split("\n").filter(value => value.startsWith("id: ")).length, 5);
    const resumed = await server.fetch(`/stream?${query}`, { headers: { authorization: `Bearer ${apiKey}`, "last-event-id": "3" } });
    assert.equal(resumed.status, 200);
    assert(!(await resumed.text()).includes("Persisted platform output"), "user API key has equivalent access and honors output cursor");
    assert.equal((await server.fetch(`/cancel?${query}`, { method: "POST", headers: { cookie: teammate.cookie } })).status, 404);
    const cancel = await server.fetch(`/cancel?${query}`, { method: "POST", headers: { cookie: owner.cookie } });
    assert.equal(cancel.status, 204);
    const [canceled] = await database.db.select().from(agentRuns).where(eq(agentRuns.id, run.id));
    assert(canceled.cancelRequestedAt, "the actual platform cancellation write commits before RPC ack");

    await database.db.update(agentExecutions).set({ status: "invoking" }).where(eq(agentExecutions.id, execution.id));
    const live = await server.fetch(`/stream?${query}&after=5`, { headers: { cookie: owner.cookie } });
    assert.equal(live.status, 200);
    await database.db.delete(member).where(eq(member.id, ownerMember));
    const revoked = await live.text();
    assert(revoked.includes('"type":"error"'), "replay re-resolves current owner membership while live");
    assert.equal((await server.fetch(`/stream?${query}`, { headers: { authorization: `Bearer ${apiKey}` } })).status, 401);
    assert.equal((await command("batchAddRows", { tableId: table.id, rows: [{ cells: {} }] })).status, 401, "deleted membership revokes command access immediately");
    assert.equal((await server.fetch(`/cancel?${query}`, { method: "POST", headers: { cookie: owner.cookie } })).status, 403);
  } finally {
    await server.close();
    await database.db.delete(organization).where(eq(organization.id, orgId));
    for (const id of [...accounts, agentUser]) await database.db.delete(user).where(eq(user.id, id));
    await database.close();
  }
});
