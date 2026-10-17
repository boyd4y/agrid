import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { createDatabase } from "../../src/business/db/factory.js";
import { organization, user, member, workspaces, tables, automations, automationRuns, automationAgentActions, chatThreads } from "../../src/business/db/schema.js";
import { listAutomationRuns, listRuleRuns, mapRule } from "../../src/business/automation/crud.js";
import { listScheduledRuns } from "../../src/business/automation/scheduled-runs.js";
import { createAutomationsRoute } from "../../src/business/http/automations.js";
import { createCommandsRoute } from "../../src/business/http/commands.js";
import { createTableTools } from "../../src/business/agent/tools/index.js";
import { withPlatformResources } from "../../src/resources/scope.js";
import * as compatibility from "../../src/automation/crud.js";
import * as commandCompatibility from "../../src/commands/index.js";
import type { CommandDependencies } from "../../src/business/dependencies.js";
import type { Actor } from "../../src/business/auth/actor.js";

const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test")); assert.equal(process.env.DATABASE_URL_UNPOOLED, url);
const resource = createDatabase({ connectionString: url, poolMax: 5 });
const db = resource.db, org = randomUUID(), owner = randomUUID(), peer = randomUUID(), admin = randomUUID();
const runIds: string[] = [];
let deps: CommandDependencies = { database: db, now: () => new Date(), uuid: randomUUID, automationQueueName: "visibility-test" };
let tableId: string, secondWorkspace: string, viewer = peer;
let privateRun: typeof automationRuns.$inferSelect, privateThread: string, ruleId: string;
const answer = `Private turn ${randomUUID()}`;
const actor = (id: string): Actor => ({ kind: "human", userId: id, memberId: id, organizationId: org, workspaceId: deps.workspaceId,
  role: id === owner ? "owner" : id === admin ? "admin" : "member", name: id, email: `${id}@local.test` });
const scope = async () => ({ commands: deps, identity: { database: db,
  resolveSession: async () => ({ user: { id: viewer, name: viewer, email: `${viewer}@local.test` }, session: { activeOrganizationId: org } }) }, close: async () => {} });
const app = new Hono().route("/api", createAutomationsRoute(scope)).route("/api/commands", createCommandsRoute(scope));
const input = (id?: string) => ({ organizationId: org, actorId: id, automationId: ruleId });
const containsPrivate = (value: unknown) => [answer, privateThread].some(secret => JSON.stringify(value).includes(secret));
async function rule(schedule = false) {
  const [saved] = await db.insert(automations).values({ organizationId: org, workspaceId: deps.workspaceId, createdByUserId: owner, name: "Visibility",
    source: schedule ? { kind: "schedule", cron: "0 9 * * *", timeZone: "UTC" } : { kind: "table", tableId }, tableId: schedule ? null : tableId,
    trigger: { type: schedule ? "schedule_due" : "row_created" }, actions: [{ type: "run_agent", agentUserId: owner, prompt: "Private prompt" }] }).returning();
  return saved;
}
async function saveRun(saved: Awaited<ReturnType<typeof rule>>, threadOwner = owner, legacy = false) {
  const threadId = randomUUID();
  const [run] = await db.insert(automationRuns).values({ automationId: saved.id, workspaceId: deps.workspaceId, tableId: saved.tableId,
    triggerType: mapRule(saved).trigger.type, status: "completed", ruleSnapshot: legacy ? null : mapRule(saved) as unknown as Record<string, unknown>,
    error: `${answer}: private diagnostic`, detail: { threadId, actions: [{ type: "run_agent", threadId, text: answer }],
      downstream: { output: answer, recovery: { privateTurn: threadId } } } }).returning();
  runIds.push(run.id);
  await db.insert(chatThreads).values({ id: threadId, organizationId: org, workspaceId: deps.workspaceId, userId: threadOwner, clientId: randomUUID(),
    kind: saved.source.kind === "schedule" ? "scheduled_task" : "chat", scheduledTaskId: saved.source.kind === "schedule" ? saved.id : null });
  if (!legacy) await db.insert(automationAgentActions).values({ runId: run.id, step: 0, threadId, userMessageId: randomUUID() });
  return { run, threadId };
}
before(async () => {
  await db.insert(organization).values({ id: org, name: "Run visibility", slug: org });
  await db.insert(user).values([owner, peer, admin].map(id => ({ id, name: id, email: `${id}@local.test` })));
  await db.insert(member).values([owner, peer, admin].map(id => ({ id, userId: id, organizationId: org, role: actor(id).role })));
  const [workspace] = await db.select().from(workspaces).where(and(eq(workspaces.organizationId, org), eq(workspaces.isDefault, true)));
  deps = { ...deps, workspaceId: workspace.id };
  secondWorkspace = (await db.insert(workspaces).values({ organizationId: org, name: "Other" }).returning())[0].id;
  tableId = (await db.insert(tables).values({ organizationId: org, workspaceId: workspace.id, name: "Source" }).returning())[0].id;
  const saved = await rule(); ruleId = saved.id;
  const result = await saveRun(saved); privateRun = result.run; privateThread = result.threadId;
});
after(async () => {
  if (runIds.length) await db.delete(automationRuns).where(inArray(automationRuns.id, runIds));
  await db.delete(organization).where(eq(organization.id, org));
  await db.delete(user).where(inArray(user.id, [owner, peer, admin])); await resource.close();
});
test("owner sees full private results; peers/admin/missing viewer get only state without nested output or errors", async () => {
  const owned = await listAutomationRuns(deps, input(owner));
  assert(containsPrivate(owned)); assert.equal(owned[0].threadId, privateThread); assert.equal(owned[0].error, privateRun.error);
  for (const id of [peer, admin, undefined]) {
    const result = await listAutomationRuns(deps, input(id));
    assert.equal(result.length, 1); assert.equal(result[0].status, "completed");
    assert.equal(containsPrivate(result), false); assert.deepEqual(result[0].detail, {}); assert.equal(result[0].error, null);
    assert.equal(containsPrivate(await listRuleRuns(deps, ruleId, org, 50, id)), false);
    await withPlatformResources({ database: resource }, async () => {
      assert.equal(containsPrivate(await compatibility.listRuleRuns(ruleId, org, 50, id)), false);
      assert.equal(containsPrivate(await commandCompatibility.listAutomationRuns(input(id))), false);
    });
  }
  await withPlatformResources({ database: resource }, async () => assert(containsPrivate(await compatibility.listRuleRuns(ruleId, org, 50, owner))));
});
test("registered native, command and both REST histories use the trusted viewer; input cannot impersonate owner", async () => {
  const execute = (id: string, args: object) => createTableTools(deps, undefined, org, id).list_automation_runs.execute(args, { toolCallId: randomUUID(), messages: [], context: undefined });
  assert.equal(containsPrivate(await execute(owner, { automationId: ruleId })), true);
  assert.equal(containsPrivate(await execute(peer, { automationId: ruleId, actorId: owner })), false);
  for (const id of [owner, peer, admin]) {
    viewer = id;
    for (const path of [`/api/automations/${ruleId}/runs`, `/api/tables/${tableId}/automation-runs?automationId=${ruleId}`]) {
      const response = await app.request(path); assert.equal(response.status, 200);
      assert.equal(containsPrivate(await response.json()), id === owner);
    }
    const response = await app.request("/api/commands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: "listAutomationRuns", input: { automationId: ruleId } }) });
    assert.equal(response.status, 200); assert.equal(containsPrivate(await response.json()), id === owner);
  }
  viewer = peer;
  assert.equal((await app.request("/api/commands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: "listAutomationRuns", input: { automationId: ruleId, actorId: owner } }) })).status, 400);
});
test("actual MCP stdio run history preserves owned content and never exposes another member's turn", { timeout: 30000 }, async () => {
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  try {
    for (const id of [peer, owner]) {
      viewer = id;
      const output: { stdout: string; stderr: string } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL("../../../mcp/test/calendar-client.mjs", import.meta.url))], { env: {
        ...process.env, TABDO_API_URL: `http://127.0.0.1:${address.port}`, TABDO_API_KEY: "", TABLE_API_KEY: "", TABDO_WORKSPACE_ID: deps.workspaceId!,
        CALENDAR_MCP_TSX: createRequire(import.meta.url).resolve("tsx/cli"), CALENDAR_MCP_CASE: JSON.stringify({ calls: [{ name: "list_automation_runs", input: { limit: 200 },
          ...(id === owner ? { includes: [answer, privateThread] } : { absent: [answer, privateThread] }) }] }),
      } });
      assert.equal(JSON.parse(output.stdout).mcp, "PASS");
    }
  } finally { if ("closeAllConnections" in server) server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
test("historical thread ownership, legacy references, deleted threads and mixed owners are enforced", async () => {
  const saved = await rule(); const { run, threadId } = await saveRun(saved);
  await db.update(automations).set({ createdByUserId: peer, actions: [{ type: "command", command: "createTable", input: { name: "Public" } }] }).where(eq(automations.id, saved.id));
  const read = (id?: string) => listAutomationRuns(deps, { organizationId: org, actorId: id, automationId: saved.id });
  assert(JSON.stringify(await read(owner)).includes(threadId)); assert(!JSON.stringify(await read(peer)).includes(answer));
  const legacy = await saveRun(saved, owner, true);
  assert(JSON.stringify(await read(owner)).includes(legacy.threadId)); assert(!JSON.stringify(await read(admin)).includes(legacy.threadId));
  const otherThread = (await saveRun(saved, peer)).threadId;
  await db.insert(automationAgentActions).values({ runId: run.id, step: 1, threadId: otherThread, userMessageId: randomUUID() });
  for (const id of [owner, peer]) assert.equal((await read(id)).find(item => item.id === run.id)!.error, null);
  await db.delete(chatThreads).where(eq(chatThreads.id, legacy.threadId));
  assert.equal((await read(owner)).find(item => item.id === legacy.run.id)!.threadId, null);
});
test("ordinary data results remain visible, limits and workspace/organization filters remain bounded", async () => {
  const saved = await rule(); await db.update(automations).set({ actions: [] }).where(eq(automations.id, saved.id));
  const [run] = await db.insert(automationRuns).values({ automationId: saved.id, workspaceId: deps.workspaceId, tableId,
    triggerType: "row_created", status: "failed", ruleSnapshot: { actions: [] }, detail: { actions: [{ type: "command", result: { public: true } }] }, error: "Public data error" }).returning(); runIds.push(run.id);
  for (const id of [owner, peer, admin, undefined]) {
    const result = await listAutomationRuns(deps, { organizationId: org, actorId: id, automationId: saved.id });
    assert.equal(result[0].error, "Public data error"); assert.deepEqual(result[0].detail, run.detail);
  }
  assert.equal((await listAutomationRuns(deps, { organizationId: org, actorId: owner, limit: 1 })).length, 1);
  assert.deepEqual(await listAutomationRuns({ ...deps, workspaceId: secondWorkspace }, { organizationId: org, actorId: owner }), []);
  await assert.rejects(listAutomationRuns({ ...deps, workspaceId: secondWorkspace }, input(owner)), /不存在/);
  assert.deepEqual(await listAutomationRuns(deps, { organizationId: randomUUID(), actorId: owner }), []);
});
test("scheduled history follows the saved thread owner after a rule changes owner, without leaking prompt or diagnostics", async () => {
  const saved = await rule(true); const { threadId } = await saveRun(saved);
  assert(JSON.stringify(await listScheduledRuns(deps, saved.id, actor(owner))).includes(threadId));
  assert.equal((await listScheduledRuns(deps, saved.id, actor(peer))).runs.length, 0);
  await db.update(automations).set({ createdByUserId: peer }).where(eq(automations.id, saved.id));
  const oldOwner = await listScheduledRuns(deps, saved.id, actor(owner)); assert(JSON.stringify(oldOwner).includes(threadId));
  const newOwner = await listScheduledRuns(deps, saved.id, actor(peer));
  assert(!JSON.stringify(newOwner).includes(threadId)); assert(!JSON.stringify(newOwner).includes(answer)); assert.equal(newOwner.runs[0].prompt, "");
  assert.equal((await listScheduledRuns(deps, saved.id, actor(admin))).runs.length, 0);
  assert.equal((await listAutomationRuns(deps, { organizationId: org, actorId: peer, automationId: saved.id }))[0].threadId, null);
});
