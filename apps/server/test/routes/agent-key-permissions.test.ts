import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { and, eq, sql } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ApiKeyInput } from "@tabdo/shared";
import type { CommandDependencies } from "../../src/business/dependencies.js";
import type { Actor } from "../../src/business/auth/actor.js";
import { createDatabase } from "../../src/business/db/factory.js";
import { organization, user, member, workspaces, automations, automationSchedules, automationEvents, automationOccurrences, automationRuns, automationStepReceipts, rows } from "../../src/business/db/schema.js";
import { createTable, addRow, getTable } from "../../src/business/commands/index.js";
import { createSiteKey, updateSiteKey, deleteSiteKey, listSiteKeys, resolveSiteKey } from "../../src/business/data-api/keys.js";
import { createSiteApiRoutes } from "../../src/business/http/site-api.js";
import { executeCalendar } from "../../src/business/calendar/service.js";
import { createMcpRoute } from "../../src/mcp/route.js";
import { dispatchDueSchedules } from "../../src/business/automation/schedule.js";
import { claimExecution, executeNext } from "../../src/business/automation/execution.js";

const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test")); assert.equal(url, process.env.DATABASE_URL_UNPOOLED);
const resource = createDatabase({ connectionString: url, poolMax: 8 }), db = resource.db;
const org = randomUUID(), otherOrg = randomUUID(), uid = randomUUID(), mid = randomUUID();
const deps: CommandDependencies = { database: db, now: () => new Date("2030-01-01T00:00:00Z"), uuid: randomUUID, automationQueueName: "key-fixture" };
const actor: Actor = { kind: "human", organizationId: org, userId: uid, memberId: mid, role: "owner", name: "Key manager", email: `${uid}@local.test` };
const acquire = async () => ({ commands: deps, identity: { database: db, resolveSession: async () => null }, siteRateLimit: async () => {}, close: async () => {} });
const app = new Hono().route("/api", createSiteApiRoutes(acquire)).route("/mcp", createMcpRoute(acquire, { publicOrigin: "http://fixture.test", allowedOrigins: [] }));
const permission = (tableId: string) => ({ tableId, canRead: true, canCreate: true, canUpdate: true, canDelete: true });
const ruleGrant = (automationId: string) => ({ automationId, canRead: true, canUpdate: true, canDelete: true });
let a: string, b: string, empty: string, foreign: string, tableA: string, tableB: string, foreignTable: string, columnA: string;
let server: ReturnType<typeof serve>, endpoint: string;
before(async () => {
  await db.insert(organization).values([{ id: org, name: "Key organization", slug: org }, { id: otherOrg, name: "Other tenant", slug: otherOrg }]);
  await db.insert(user).values({ id: uid, name: actor.name, email: actor.email });
  await db.insert(member).values({ id: mid, organizationId: org, userId: uid, role: "owner" });
  a = (await db.select().from(workspaces).where(and(eq(workspaces.organizationId, org), eq(workspaces.isDefault, true))))[0].id;
  b = (await db.insert(workspaces).values({ organizationId: org, name: "Second workspace" }).returning())[0].id;
  empty = (await db.insert(workspaces).values({ organizationId: org, name: "Empty workspace" }).returning())[0].id;
  foreign = (await db.select().from(workspaces).where(eq(workspaces.organizationId, otherOrg)))[0].id;
  tableA = (await createTable({ ...deps, workspaceId: a }, { organizationId: org, name: "Table A" })).id;
  tableB = (await createTable({ ...deps, workspaceId: b }, { organizationId: org, name: "Table B" })).id;
  foreignTable = (await createTable({ ...deps, workspaceId: foreign }, { organizationId: otherOrg, name: "Foreign table" })).id;
  columnA = (await getTable({ ...deps, workspaceId: a }, { organizationId: org, tableId: tableA })).columns[0].id;
  server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>(resolve => server.listening ? resolve() : server.once("listening", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await db.delete(automationEvents).where(eq(automationEvents.organizationId, org));
  await db.delete(organization).where(eq(organization.id, org)); await db.delete(organization).where(eq(organization.id, otherOrg));
  await db.delete(user).where(eq(user.id, uid)); await resource.close();
});
const call = async (secret: string, command: string, input: unknown = {}, workspace = a) => {
  const response = await app.request("http://fixture.test/api/commands", { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", "X-Workspace-Id": workspace }, body: JSON.stringify({ command, input }) });
  return { status: response.status, body: await response.json() };
};
const successful = async (secret: string, command: string, input: unknown = {}, workspace = a) => {
  const response = await call(secret, command, input, workspace); assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body.result;
};
const scheduleInput = (workspaceId: string, target = tableB) => ({ workspaceId, name: randomUUID(), source: { kind: "schedule", cron: "* * * * *", timeZone: "UTC" }, trigger: { type: "schedule_due" }, actions: [{ type: "command", command: "addRow", input: { tableId: target } }] });
const execution = { ...deps, runAgentAction: async (): Promise<never> => { throw new Error("Key rule must never impersonate an agent"); } };
async function drain(eventId: string) {
  const fence = await claimExecution(execution, eventId); assert(fence !== undefined);
  for (let i = 0; i < 10; i++) if (await executeNext(execution, eventId, fence) === "done") return;
  throw new Error("Fixture did not finish");
}

test("one key spans workspaces, partitions rule types and cannot cross tenant or inherit data access", async () => {
  const listed = await listSiteKeys({ ...deps, workspaceId: b }, actor);
  assert.deepEqual(new Set(listed.workspaces.map(v => v.id)), new Set([a, b, empty]));
  assert.equal(listed.tables.length, 2);
  const input: ApiKeyInput = { name: "Cross workspace", permissions: [permission(tableA), permission(tableB)], workspacePermissions: [a, b, empty].map(workspaceId => ({ workspaceId, canCreateAutomations: true, canCreateSchedules: true })) };
  const saved = await createSiteKey(deps, actor, input);
  assert.deepEqual(new Set((await successful(saved.secret, "listWorkspaces")).map((v: { id: string }) => v.id)), new Set([a, b, empty]));
  for (const workspaceId of [a, b]) assert.deepEqual(new Set((await successful(saved.secret, "listTables", {}, workspaceId)).map((v: { id: string }) => v.id)), new Set([tableA, tableB]));
  assert.equal((await call(saved.secret, "getTable", { tableId: foreignTable })).status, 404);
  await assert.rejects(updateSiteKey(deps, actor, saved.key.id, { ...input, name: "Do not commit", workspacePermissions: [{ workspaceId: foreign, canCreateAutomations: true, canCreateSchedules: true }] }), /current organization/);
  assert.equal((await listSiteKeys(deps, actor)).keys.find(k => k.id === saved.key.id)!.name, input.name);
  const ordinary = await successful(saved.secret, "createAutomation", { workspaceId: a, tableId: tableA, name: "Source row update", trigger: { type: "row_created" }, actions: [{ type: "update_field", columnId: columnA, value: "Updated by key" }] }, b);
  const planA = await successful(saved.secret, "createAutomation", scheduleInput(a, tableA), b);
  const planB = await successful(saved.secret, "createAutomation", scheduleInput(b), a);
  assert.equal((await call(saved.secret, "createAutomation", scheduleInput(foreign))).status, 403);
  const crossInput = { ...input, automationPermissions: [ruleGrant(ordinary.id)], schedulePermissions: [ruleGrant(planA.id), ruleGrant(planB.id)] };
  await updateSiteKey(deps, actor, saved.key.id, crossInput);
  const resources = await listSiteKeys(deps, actor);
  assert(resources.automations.some(r => r.id === ordinary.id)); assert(!resources.schedules.some(r => r.id === ordinary.id));
  assert(resources.schedules.some(r => r.id === planB.id)); assert(!resources.automations.some(r => r.id === planB.id));
  const client = new Client({ name: "Key permission fixture", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { Authorization: `Bearer ${saved.secret}`, "X-Workspace-Id": b } } }));
    const scopedWorkspaces = await client.callTool({ name: "list_workspaces", arguments: {} }); assert(!scopedWorkspaces.isError);
    const list = await client.callTool({ name: "list_automations", arguments: {} }); assert(!list.isError, JSON.stringify(list));
    const rules = JSON.parse((list.content as { text: string }[])[0].text); assert.equal(rules.length, 3);
    const update = await client.callTool({ name: "update_automation", arguments: { automationId: ordinary.id, name: "MCP edit", expectedVersion: 1 } }); assert(!update.isError, JSON.stringify(update));
    const denied = await client.callTool({ name: "create_view", arguments: { tableId: tableA, name: "Denied", type: "site", config: { template: "blog" }, idempotencyKey: randomUUID() } }); assert(denied.isError);
    const unauthorized = await client.callTool({ name: "delete_automation", arguments: { automationId: randomUUID() } }); assert(unauthorized.isError);
  } finally { await client.close(); }
  assert.equal((await call(saved.secret, "updateAutomation", { automationId: planB.id, expectedVersion: 1, actions: [{ type: "command", command: "addRow", input: { tableId: tableB } }] })).status, 403, "legacy timing grants do not expand");
  await updateSiteKey(deps, actor, saved.key.id, { ...crossInput, schedulePermissions: crossInput.schedulePermissions.map(g => ({ ...g, grantVersion: 2 })) });
  await successful(saved.secret, "updateAutomation", { automationId: planB.id, expectedVersion: 1, actions: [{ type: "command", command: "addRow", input: { tableId: tableB } }] });
  const occurrences = await successful(saved.secret, "queryScheduledOccurrences", { automationIds: [planA.id, planB.id], rangeStart: "2030-01-01T00:00:00Z", rangeEnd: "2030-01-01T00:03:00Z", limit: 20 }); assert(occurrences.items.length > 0);
  assert.equal((await call(saved.secret, "createView", {})).status, 403); assert.equal((await call(saved.secret, "createReport", {})).status, 403);
  const narrow = await createSiteKey(deps, actor, { name: "No data", permissions: [], workspacePermissions: input.workspacePermissions, automationPermissions: [ruleGrant(ordinary.id)], schedulePermissions: [ruleGrant(planB.id)] });
  assert.equal((await call(narrow.secret, "createAutomation", scheduleInput(b))).status, 404);
  assert.equal((await call(narrow.secret, "updateAutomation", { automationId: ordinary.id, expectedVersion: 2, enabled: true })).status, 404);
  assert.equal((await call(narrow.secret, "listAutomations")).status, 404);
  assert.equal((await call(saved.secret, "createAutomation", { ...scheduleInput(b), actions: [{ type: "run_agent", agentUserId: uid, prompt: "Escalate" }] })).status, 403);
  const sourceRow = await addRow({ ...deps, workspaceId: a }, { organizationId: org, actorId: uid, tableId: tableA });
  const [event] = await db.select().from(automationEvents).where(eq(automationEvents.rowId, sourceRow.id)); assert(event);
  await drain(event.id);
  assert.equal((await db.select().from(rows).where(eq(rows.id, sourceRow.id)))[0].cells[columnA], "Updated by key");
  const [run] = await db.select().from(automationRuns).where(eq(automationRuns.eventId, event.id));
  assert.equal((await db.select().from(automationStepReceipts).where(eq(automationStepReceipts.runId, run.id))).length, 1);
  await successful(saved.secret, "updateAutomation", { automationId: planB.id, expectedVersion: 2, source: { kind: "schedule", cron: "*/2 * * * *", timeZone: "UTC" } });
  await successful(saved.secret, "deleteAutomation", { automationId: planA.id });
  assert.equal((await call(saved.secret, "updateAutomation", { automationId: planA.id, expectedVersion: 1, name: "Gone" })).status, 404);
  await assert.rejects(updateSiteKey(deps, actor, narrow.key.id, { name: "Wrong category", permissions: [], schedulePermissions: [ruleGrant(ordinary.id)] }), /scheduled rules/);
});

test("scheduled execution rechecks grants and commits its receipt with the data write", async () => {
  const input: ApiKeyInput = { name: "Execution binding", permissions: [permission(tableB)], workspacePermissions: [{ workspaceId: b, canCreateAutomations: false, canCreateSchedules: true }] };
  const saved = await createSiteKey(deps, actor, input);
  const plan = await successful(saved.secret, "createAutomation", scheduleInput(b));
  const count = async () => (await db.select().from(rows).where(eq(rows.tableId, tableB))).length;
  const before = await count();
  const due = async () => {
    await db.update(automationSchedules).set({ nextRunAt: deps.now() }).where(eq(automationSchedules.automationId, plan.id));
    await dispatchDueSchedules(deps, deps.now(), 100, org);
    return (await db.select().from(automationOccurrences).where(eq(automationOccurrences.automationId, plan.id)))[0].eventId;
  };
  const eventId = await due();
  const [pending] = await db.select().from(automationRuns).where(eq(automationRuns.eventId, eventId));
  const trigger = `key_receipt_${randomUUID().replaceAll("-", "")}`;
  await db.execute(sql.raw(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.run_id = '${pending.id}'::uuid THEN RAISE EXCEPTION 'Key receipt failure'; END IF; RETURN NEW; END $$`));
  try {
    await db.execute(sql.raw(`CREATE TRIGGER ${trigger} BEFORE INSERT ON automation_step_receipts FOR EACH ROW EXECUTE FUNCTION ${trigger}()`));
    const fence = await claimExecution(execution, eventId); assert(fence !== undefined);
    try { await assert.rejects(executeNext(execution, eventId, fence), error => String((error as { cause?: Error }).cause ?? error).includes("Key receipt failure")); }
    finally { await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${trigger} ON automation_step_receipts`)); }
  } finally { await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${trigger}()`)); }
  assert.equal(await count(), before, "the key data write rolls back if its receipt cannot commit");
  assert.equal((await db.select().from(automationStepReceipts).where(eq(automationStepReceipts.runId, pending.id))).length, 0);
  await drain(eventId);
  assert.equal(await count(), before + 1);
  const [run] = await db.select().from(automationRuns).where(eq(automationRuns.eventId, eventId));
  assert.equal(run.status, "completed"); assert.equal((await db.select().from(automationStepReceipts).where(eq(automationStepReceipts.runId, run.id))).length, 1);
  // A second occurrence, accepted before revocation, cannot borrow the creator's data access.
  await db.update(automationSchedules).set({ nextRunAt: new Date(+deps.now() - 60_000) }).where(eq(automationSchedules.automationId, plan.id));
  await dispatchDueSchedules(deps, deps.now(), 100, org);
  const occurrences = await db.select().from(automationOccurrences).where(eq(automationOccurrences.automationId, plan.id));
  const second = occurrences.find(item => item.eventId !== eventId)!; assert(second);
  await updateSiteKey(deps, actor, saved.key.id, { ...input, permissions: [] });
  await drain(second.eventId); assert.equal(await count(), before + 1);
  assert.equal((await db.select().from(automationRuns).where(eq(automationRuns.eventId, second.eventId)))[0].status, "cancelled");
  await deleteSiteKey(deps, actor, saved.key.id);
  assert.equal((await db.select().from(automations).where(eq(automations.id, plan.id)))[0].executionKeyId, saved.key.id);
  await assert.rejects(resolveSiteKey(db, saved.secret), /Invalid API/);
});

test("calendar grants span workspaces and key management/current owner authorization are live", async () => {
  const calendar = await executeCalendar({ ...deps, workspaceId: b }, { kind: "member", organizationId: org, actorId: uid }, "createCalendar", { name: "Second calendar", timeZone: "UTC", idempotencyKey: randomUUID() });
  const saved = await createSiteKey(deps, actor, { name: "Calendar only", permissions: [], calendarPermissions: [{ calendarId: calendar.id, canRead: true, canReadAvailability: false, canCreate: false, canUpdate: false, canCancel: false, canManage: false }] });
  const fromA = await successful(saved.secret, "listCalendars", {}, a), fromB = await successful(saved.secret, "listCalendars", {}, b);
  assert.deepEqual(fromA, fromB); assert(JSON.stringify(fromA).includes(calendar.id));
  await db.update(member).set({ role: "member" }).where(eq(member.id, mid));
  try {
    assert.equal((await call(saved.secret, "listCalendars")).status, 403);
    await assert.rejects(createSiteKey(deps, actor, { name: "Stale actor", permissions: [permission(tableA)] }), /management permission/);
    await assert.rejects(listSiteKeys(deps, actor), /management permission/);
  } finally { await db.update(member).set({ role: "owner" }).where(eq(member.id, mid)); }
});
