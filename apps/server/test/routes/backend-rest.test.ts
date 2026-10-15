import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDatabase } from "../../src/business/db/factory.js";
import type { Actor } from "../../src/business/auth/actor.js";
import type { RequestScopeResolver } from "../../src/business/http/request.js";
import { createTablesRoute } from "../../src/business/http/tables.js";
import { createRowsRoute } from "../../src/business/http/rows.js";
import { createColumnsRoute } from "../../src/business/http/columns.js";
import { createThreadsRoute } from "../../src/business/http/threads.js";
import { createMembersRoute } from "../../src/business/http/members.js";
import { createApiKeysRoute } from "../../src/business/http/api-keys.js";
import { createApiKey } from "../../src/business/services/api-keys.js";
import { organization, user, member, agentProfile, agentRuntimeSessions, agentRuns } from "../../src/business/db/schema.js";
import { agentExecutions } from "../../src/business/db/schema.js";
import { loadBuiltinSkillDocuments } from "../../src/skills/builtin-loader.js";
import { getAgentToolCatalog } from "../../src/harness/tool-catalog.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString || !new URL(connectionString).pathname.endsWith("_agent_test")) throw new Error("Use an isolated *_agent_test database");
const admin = createDatabase({ connectionString, poolMax: 3 });
const org = randomUUID(), account = randomUUID(), membership = randomUUID();
const actor: Actor = { userId: account, organizationId: org, memberId: membership, role: "owner", kind: "human", name: "REST owner", email: `${account}@local.test` };
let secret = "", acquired = 0, closed = 0;
const cleaned: { runtimeId: string; executionIds: readonly string[] }[] = [];
const createdAgents: string[] = [];
const builtins = loadBuiltinSkillDocuments();
const acquire: RequestScopeResolver = async () => {
  acquired++;
  const resource = createDatabase({ connectionString, poolMax: 1 });
  return {
    commands: { database: resource.db, now: () => new Date(), uuid: randomUUID, automationQueueName: "fixture" },
    identity: { database: resource.db, resolveSession: async () => null },
    builtinSkills: builtins, toolCatalog: getAgentToolCatalog,
    async discardRuntime(runtimeId, executionIds = []) {
      // No compute was launched in this fixture. Capture the cleanup contract.
      cleaned.push({ runtimeId, executionIds });
    },
    async close() { closed++; await resource.close(); },
  };
};
const app = new Hono().route("/api/tables", createTablesRoute(acquire)).route("/api", createRowsRoute(acquire))
  .route("/api", createColumnsRoute(acquire)).route("/api/threads", createThreadsRoute(acquire))
  .route("/api/members", createMembersRoute(acquire)).route("/api/user/api-keys", createApiKeysRoute(acquire));
const request = (path: string, body?: unknown, method = body === undefined ? "GET" : "POST", key = secret) => app.request(`https://fixture.test/api${path}`, {
  method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
});
before(async () => {
  await admin.db.insert(organization).values({ id: org, name: "Portable REST", slug: org });
  await admin.db.insert(user).values({ id: account, name: actor.name, email: actor.email, emailVerified: true, kind: "human" });
  await admin.db.insert(member).values({ id: membership, userId: account, organizationId: org, role: "owner" });
  secret = (await createApiKey({ database: admin.db }, actor, { name: "Fixture" })).secret;
});
after(async () => {
  await admin.db.delete(organization).where(eq(organization.id, org));
  for (const id of createdAgents) await admin.db.delete(user).where(eq(user.id, id));
  await admin.db.delete(user).where(eq(user.id, account));
  await admin.close();
});

test("shared REST factories operate through real Bearer identity with per-request DB lifetime and no ALS", async () => {
  assert.equal((await request("/tables", undefined, "GET", "")).status, 401);
  const created = await request("/tables", { name: "Portable table" }); assert.equal(created.status, 201);
  const table = await created.json();
  const columnResponse = await request(`/tables/${table.id}/columns`, { name: "Amount", type: "number" });
  assert.equal(columnResponse.status, 201); const column = await columnResponse.json();
  const beforeRowRequest = acquired;
  const added = await request(`/tables/${table.id}/rows`, { cells: { [column.id]: 4 } }); assert.equal(added.status, 201);
  assert.equal(acquired, beforeRowRequest + 1, "overlapping REST middleware shares one resolver acquisition");
  const row = await added.json();
  assert.equal((await request(`/rows/${row.id}`, { cells: { [column.id]: 8 } }, "PATCH")).status, 200);
  const page = await (await request(`/tables/${table.id}/rows/query`, { includeTotal: true })).json();
  assert.equal(page.rows[0].cells[column.id], 8); assert.equal(page.totalMatched, 1);
  assert.equal((await request("/tables", { name: "portable TABLE" })).status, 409);
  assert.equal((await request(`/tables/${table.id}`, { description: "Changed" }, "PATCH")).status, 200);
  assert.equal((await request("/members")).status, 200);
  assert.equal(acquired, closed, "success, validation and authorization failures all release request resources");
});

test("portable member creation uses actual builtin skills and deletion carries execution handles before PG cascade", async () => {
  const created = await request("/members/agents", { name: "Portable agent", persona: { skillNames: ["table"], defaultHarness: "pi", runtime: "local" } });
  assert.equal(created.status, 201); const agent = (await created.json()).member; createdAgents.push(agent.userId);
  const invalid = await request("/members/agents", { name: "Invalid skills", persona: { skillNames: ["missing-skill"] } });
  assert.equal(invalid.status, 400);
  const response = await request("/threads", { clientId: randomUUID(), context: { page: "ai" }, agentId: agent.userId });
  assert.equal(response.status, 201); const thread = await response.json();
  assert.equal((await request(`/threads/${thread.id}`, { custom: { agentId: randomUUID() } }, "PATCH")).status, 409);
  const [profile] = await admin.db.select().from(agentProfile).where(eq(agentProfile.userId, agent.userId));
  assert.equal(profile.persona?.defaultModel, "__harness_default__", "API-created agents follow the configured provider instead of hardcoding OpenRouter");
  const [runtime] = await admin.db.insert(agentRuntimeSessions).values({ threadId: thread.id, agentProfileId: profile.id, harness: "pi", mode: "local", sandboxId: "fixture-no-compute" }).returning();
  const [run] = await admin.db.insert(agentRuns).values({ threadId: thread.id, runtimeSessionId: runtime.id,
    userMessageId: randomUUID(), assistantMessageId: randomUUID(), fence: 1, status: "completed" }).returning();
  const [execution] = await admin.db.insert(agentExecutions).values({ runId: run.id, fence: 1, leaseToken: randomUUID(), status: "settled", input: { protocol: 1, context: {}, prompt: "Fixture" } }).returning();
  assert.equal((await request(`/threads/${thread.id}`, undefined, "DELETE")).status, 200);
  assert.deepEqual(cleaned, [{ runtimeId: runtime.id, executionIds: [execution.id] }]);
  assert.equal((await admin.db.select().from(agentExecutions).where(eq(agentExecutions.id, execution.id))).length, 0);
  await admin.db.delete(member).where(eq(member.id, membership));
  assert.equal((await request("/tables")).status, 401, "a live membership is required for the same API key");
  assert.equal(acquired, closed);
});
