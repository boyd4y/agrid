import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { and, eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ApiKeyInput } from "@tabdo/shared";
import type { CommandDependencies } from "../../src/business/dependencies.js";
import type { Actor } from "../../src/business/auth/actor.js";
import type { ActionInput } from "../../src/business/automation/agent-action.js";
import { createDatabase } from "../../src/business/db/factory.js";
import { organization, user, member, agentProfile, workspaces, automations, automationSchedules, automationOccurrences, automationEvents, automationRuns, rows } from "../../src/business/db/schema.js";
import { createTable } from "../../src/business/commands/index.js";
import { createAutomation } from "../../src/business/automation/crud.js";
import { createSiteKey, updateSiteKey } from "../../src/business/data-api/keys.js";
import { createSiteApiRoutes } from "../../src/business/http/site-api.js";
import { createMcpRoute } from "../../src/mcp/route.js";
import { dispatchDueSchedules } from "../../src/business/automation/schedule.js";
import { claimExecution, executeNext } from "../../src/business/automation/execution.js";

const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test")); assert.equal(url, process.env.DATABASE_URL_UNPOOLED);
const resource = createDatabase({ connectionString: url, poolMax: 5 }), db = resource.db;
const org = randomUUID(), otherOrg = randomUUID(), managerId = randomUUID(), creatorId = randomUUID(), agentId = randomUUID();
const deps: CommandDependencies = { database: db, now: () => new Date("2030-01-01T00:00:00Z"), uuid: randomUUID, automationQueueName: "schedule-control-fixture" };
const manager: Actor = { kind: "human", organizationId: org, userId: managerId, memberId: randomUUID(), role: "owner", name: "Key manager", email: `${managerId}@local.test` };
const acquire = async () => ({ commands: deps, identity: { database: db, resolveSession: async () => null }, siteRateLimit: async () => {}, close: async () => {} });
const app = new Hono().route("/api", createSiteApiRoutes(acquire)).route("/mcp", createMcpRoute(acquire, { publicOrigin: "http://fixture.test", allowedOrigins: [] }));
let workspaceId: string, foreignWorkspace: string, tableId: string;
let server: ReturnType<typeof serve>, endpoint: string;
const current = async (id: string) => (await db.select().from(automations).where(eq(automations.id, id)))[0];
const calls: ActionInput[] = [];
const execution = { ...deps, runAgentAction: async (input: ActionInput) => {
  calls.push(input);
  return { status: "completed" as const, threadId: null, agentRunId: null, text: "Existing approved action" };
} };

before(async () => {
  await db.insert(organization).values([{ id: org, name: "Schedule controls", slug: org }, { id: otherOrg, name: "Other tenant", slug: otherOrg }]);
  await db.insert(user).values([managerId, creatorId, agentId].map(id => ({ id, name: id, email: `${id}@local.test`, kind: id === agentId ? "agent" : "human" })));
  const agentMemberId = randomUUID();
  await db.insert(member).values([{ id: manager.memberId, organizationId: org, userId: managerId, role: "owner" },
    { id: randomUUID(), organizationId: org, userId: creatorId, role: "member" },
    { id: agentMemberId, organizationId: org, userId: agentId, role: "member" },
    { id: randomUUID(), organizationId: otherOrg, userId: creatorId, role: "member" }]);
  await db.insert(agentProfile).values({ userId: agentId, memberId: agentMemberId, organizationId: org, displayName: "Approved agent" });
  workspaceId = (await db.select().from(workspaces).where(and(eq(workspaces.organizationId, org), eq(workspaces.isDefault, true))))[0].id;
  foreignWorkspace = (await db.select().from(workspaces).where(eq(workspaces.organizationId, otherOrg)))[0].id;
  tableId = (await createTable({ ...deps, workspaceId }, { organizationId: org, name: "Existing destination" })).id;
  server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>(resolve => server.listening ? resolve() : server.once("listening", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await db.delete(automationEvents).where(eq(automationEvents.organizationId, org));
  await db.delete(organization).where(eq(organization.id, org)); await db.delete(organization).where(eq(organization.id, otherOrg));
  for (const id of [managerId, creatorId, agentId]) await db.delete(user).where(eq(user.id, id));
  await resource.close();
});
const source = { kind: "schedule" as const, cron: "0 8 * * *", timeZone: "Asia/Shanghai" };
const action = { type: "run_agent" as const, agentUserId: agentId, prompt: "Existing approved prompt" };
const existing = (actions = [action] as Parameters<typeof createAutomation>[1]["actions"]) => createAutomation({ ...deps, workspaceId }, {
  organizationId: org, actorId: creatorId, source, name: randomUUID(), trigger: { type: "schedule_due" }, actions,
});
const scheduleKey = (id: string, grantVersion: 1 | 2, canUpdate = true) => createSiteKey(deps, manager, {
  name: randomUUID(), permissions: [], schedulePermissions: [{ automationId: id, canRead: true, canUpdate, grantVersion }],
});
const request = async (secret: string, path: string, body: unknown, method = "POST") => app.request(`http://fixture.test/api${path}`, {
  method, headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const update = async (secret: string, id: string, patch: Record<string, unknown>) => request(secret, "/commands", {
  command: "updateAutomation", input: { automationId: id, expectedVersion: (await current(id)).version, ...patch },
});
const ok = async (response: Response) => assert.equal(response.status, 200, await response.text());
async function executeDue(id: string) {
  await db.update(automationSchedules).set({ nextRunAt: deps.now() }).where(eq(automationSchedules.automationId, id));
  await dispatchDueSchedules(deps, deps.now(), 100, org);
  const [occurrence] = await db.select().from(automationOccurrences).where(eq(automationOccurrences.automationId, id)); assert(occurrence);
  const fence = await claimExecution(execution, occurrence.eventId); assert(fence !== undefined);
  for (let i = 0; i < 5; i++) if (await executeNext(execution, occurrence.eventId, fence) === "done")
    return (await db.select().from(automationRuns).where(eq(automationRuns.eventId, occurrence.eventId)))[0];
  throw new Error("Schedule fixture did not finish");
}

for (const grantVersion of [1, 2] as const) {
  test(`v${grantVersion} schedule controls preserve approved agent actions and execution identity across transports`, async () => {
    const rule = await existing(), key = await scheduleKey(rule.id, grantVersion);
    const saved = await current(rule.id);
    await ok(await update(key.secret, rule.id, { source: { ...source, cron: "30 8 * * *" } }));
    await ok(await request(key.secret, `/automations/${rule.id}`, { expectedVersion: (await current(rule.id)).version, source: { ...source, cron: "30 8 * * *", timeZone: "UTC" } }, "PATCH"));
    const graph = await request(key.secret, "/graphql", { query: "mutation($input:JSON!){updateAutomation(input:$input)}", variables: {
      input: { automationId: rule.id, expectedVersion: (await current(rule.id)).version, enabled: false },
    } });
    assert.equal(graph.status, 200); const body = await graph.json(); assert(!body.errors, JSON.stringify(body));
    assert.equal((await db.select().from(automationSchedules).where(eq(automationSchedules.automationId, rule.id))).length, 0);
    const client = new Client({ name: "schedule-controls", version: "1" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { Authorization: `Bearer ${key.secret}` } } }));
      const enabled = await client.callTool({ name: "update_automation", arguments: { automationId: rule.id, expectedVersion: (await current(rule.id)).version, enabled: true } });
      assert(!enabled.isError, JSON.stringify(enabled));
    } finally { await client.close(); }
    await ok(await update(key.secret, rule.id, { name: `Renamed v${grantVersion}` }));
    const updated = await current(rule.id);
    assert.deepEqual(updated.actions, saved.actions); assert.deepEqual(updated.trigger, saved.trigger);
    assert.equal(updated.createdByUserId, creatorId); assert.equal(updated.executionKeyId, null);
    const [schedule] = await db.select().from(automationSchedules).where(eq(automationSchedules.automationId, rule.id));
    assert.equal(schedule.ruleVersion, updated.version); assert.equal(schedule.nextRunAt.toISOString(), "2030-01-01T08:30:00.000Z");
    await ok(await request(key.secret, "/commands", { command: "queryScheduledOccurrences", input: { automationIds: [rule.id], rangeStart: "2030-01-01T00:00:00Z", rangeEnd: "2030-01-02T00:00:00Z", limit: 5 } }));
    await ok(await request(key.secret, "/commands", { command: "listAutomations" }));
    const count = calls.length, run = await executeDue(rule.id);
    assert.equal(run.status, "completed"); assert.equal(calls.length, count + 1);
    assert.equal(calls.at(-1)!.actorUserId, creatorId); assert.deepEqual(calls.at(-1)!.action, action);
    assert.equal((await current(rule.id)).executionKeyId, null, "adjusting timing must not convert a member task into a key-bound task");
  });

  test(`v${grantVersion} controls existing data actions without requiring or acquiring table permissions`, async () => {
    const rule = await existing([{ type: "command", command: "addRow", input: { tableId } }]), key = await scheduleKey(rule.id, grantVersion);
    await ok(await update(key.secret, rule.id, { source: { ...source, cron: "15 9 * * *", timeZone: "UTC" }, enabled: true }));
    const before = (await db.select().from(rows).where(eq(rows.tableId, tableId))).length;
    assert.equal((await executeDue(rule.id)).status, "completed");
    assert.equal((await db.select().from(rows).where(eq(rows.tableId, tableId))).length, before + 1);
    assert.equal((await current(rule.id)).executionKeyId, null);
    const denied = await request(key.secret, "/commands", { command: "addRow", input: { tableId } }); assert.equal(denied.status, 404);
  });
}

test("schedule controls never replace an existing key binding or bypass revoked execution grants", async () => {
  const grants: ApiKeyInput = { name: randomUUID(), permissions: [{ tableId, canRead: true, canCreate: true, canUpdate: false, canDelete: false }],
    workspacePermissions: [{ workspaceId, canCreateAutomations: false, canCreateSchedules: true }] };
  const creatorKey = await createSiteKey(deps, manager, grants);
  const response = await request(creatorKey.secret, "/commands", { command: "createAutomation", input: { workspaceId, name: randomUUID(), source, trigger: { type: "schedule_due" }, actions: [{ type: "command", command: "addRow", input: { tableId } }] } });
  assert.equal(response.status, 200); const id = (await response.json()).result.id;
  const controller = await scheduleKey(id, 2);
  await ok(await update(controller.secret, id, { source: { ...source, cron: "0 10 * * *" }, enabled: true }));
  assert.equal((await current(id)).executionKeyId, creatorKey.key.id);
  await updateSiteKey(deps, manager, creatorKey.key.id, { ...grants, permissions: [] });
  const before = (await db.select().from(rows).where(eq(rows.tableId, tableId))).length;
  assert.equal((await executeDue(id)).status, "cancelled");
  assert.equal((await db.select().from(rows).where(eq(rows.tableId, tableId))).length, before);
});

test("timing authorization does not permit new actions, source changes, foreign resources or stale updates", async () => {
  const rule = await existing();
  const foreignTable = (await createTable({ ...deps, workspaceId: foreignWorkspace }, { organizationId: otherOrg, name: "Foreign destination" })).id;
  const foreign = await createAutomation({ ...deps, workspaceId: foreignWorkspace }, { organizationId: otherOrg, actorId: creatorId,
    name: randomUUID(), source, trigger: { type: "schedule_due" }, actions: [{ type: "command", command: "addRow", input: { tableId: foreignTable } }] });
  for (const grantVersion of [1, 2] as const) {
    const key = await scheduleKey(rule.id, grantVersion), before = await current(rule.id);
    assert.equal((await update(key.secret, rule.id, { actions: [{ ...action, prompt: "Unapproved" }] })).status, 403);
    for (const patch of [{ trigger: { type: "schedule_due" } }, { conditions: [] }, { eventConditions: [] }, { conditionLogic: "or" },
      { enabled: false, actions: [{ ...action, prompt: "Hidden in disable" }] }])
      assert.equal((await update(key.secret, rule.id, patch)).status, 403, "configuration fields cannot use the schedule-control authorization");
    const data = await update(key.secret, rule.id, { actions: [{ type: "command", command: "addRow", input: { tableId } }] });
    assert.equal(data.status, grantVersion === 1 ? 403 : 404);
    assert.notEqual((await update(key.secret, rule.id, { source: { kind: "table", tableId } })).status, 200);
    assert.equal((await update(key.secret, foreign.id, { name: "Forbidden" })).status, 404);
    assert.equal((await update(key.secret, rule.id, { expectedVersion: before.version + 1, enabled: true })).status, 409);
    assert.notEqual((await update(key.secret, rule.id, { source: { ...source, cron: "invalid" } })).status, 200);
    assert.deepEqual(await current(rule.id), before, "rejected changes leave the rule and execution identity intact");
    const readOnly = await scheduleKey(rule.id, grantVersion, false);
    assert.equal((await update(readOnly.secret, rule.id, { enabled: true })).status, 403);
    await updateSiteKey(deps, manager, key.key.id, { name: "Revoked schedule", permissions: [], workspacePermissions: [{ workspaceId, canCreateAutomations: false, canCreateSchedules: true }] });
    assert.equal((await update(key.secret, rule.id, { enabled: true })).status, 403);
  }
});
