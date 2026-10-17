import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, inArray, sql } from "drizzle-orm";
import { createDatabase } from "../../src/business/db/factory.js";
import type { CommandDependencies } from "../../src/business/dependencies.js";
import type { Actor } from "../../src/business/auth/actor.js";
import type { RequestScopeResolver } from "../../src/business/http/request.js";
import { createCommandsRoute } from "../../src/business/http/commands.js";
import { createTablesRoute } from "../../src/business/http/tables.js";
import { createRowsRoute } from "../../src/business/http/rows.js";
import { createAutomationsRoute } from "../../src/business/http/automations.js";
import { createReportsRoute } from "../../src/business/http/reports.js";
import { createSitesRoute } from "../../src/business/http/sites.js";
import { createThreadsRoute } from "../../src/business/http/threads.js";
import { createFilesRoute } from "../../src/business/http/files.js";
import { dispatchCommand } from "../../src/business/services/command-dispatch.js";
import { appendExternalAutomationEvent } from "../../src/business/automation/events.js";
import { claimExecution, executeNext } from "../../src/business/automation/execution.js";
import * as commands from "../../src/business/commands/index.js";
import * as reportService from "../../src/business/reports/service.js";
import * as threadService from "../../src/business/services/threads.js";
import * as siteService from "../../src/business/sites/service.js";
import { organization, user, member, workspaces, rows, fileObjects, automations,
  automationEvents, automationRuns, automationStepReceipts, chatThreads, webhookEndpoints } from "../../src/business/db/schema.js";

const url = process.env.DATABASE_URL ?? "";
assert(new URL(url).pathname.endsWith("_agent_test"));
const resource = createDatabase({ connectionString: url, poolMax: 8 });
const org = randomUUID(), otherOrg = randomUUID(), uid = randomUUID(), otherUid = randomUUID(), memberId = randomUUID();
const deps: CommandDependencies = { database: resource.db, now: () => new Date(), uuid: randomUUID,
  automationQueueName: "agrid-queue-test-workspace-acceptance", sites: {
    publicOrigin: "https://sites.local.test", apiOrigin: "https://api.local.test", appOrigin: "https://app.local.test",
    sdkUrl: "https://api.local.test/sdk.js", storageDriver: "local", storage: () => { throw new Error("Unexpected site storage access"); },
  } };
const scope = { organizationId: org, actorId: uid };
let a: CommandDependencies, b: CommandDependencies, foreignId: string, actor: Actor;
let tableId: string, columnId: string, rowId: string, fileColumnId: string, fileId: string;
let reportId: string, siteId: string, threadId: string, ruleId: string;
let storageCalls = 0;
const acquire: RequestScopeResolver = async () => ({ commands: deps, identity: { database: resource.db,
  async resolveSession(headers) {
    const cookie = headers.get("cookie");
    if (cookie !== "fixture=owner" && cookie !== "fixture=peer") return null;
    return { user: { id: cookie === "fixture=owner" ? uid : otherUid, name: "Fixture", email: "fixture@local.test" },
      session: { activeOrganizationId: org } };
  },
}, files: { limits: { maxFiles: 2, maxFileBytes: 100, maxBodyBytes: 1000 }, storage() {
  storageCalls++; throw new Error("Cross-workspace download reached storage");
} }, discardRuntime: async () => {}, close: async () => {} });
const app = new Hono().route("/api/commands", createCommandsRoute(acquire))
  .route("/api/reports", createReportsRoute(acquire)).route("/api/sites", createSitesRoute(acquire))
  .route("/api/threads", createThreadsRoute(acquire)).route("/api", createFilesRoute(acquire))
  .route("/api", createAutomationsRoute(acquire)).route("/api", createRowsRoute(acquire))
  .route("/api/tables", createTablesRoute(acquire));
const request = (workspaceId: string | undefined, path: string, body?: unknown, method = body === undefined ? "GET" : "POST", cookie = "fixture=owner") =>
  app.request(`http://local.test/api${path}`, { method, headers: { Cookie: cookie,
    ...(workspaceId === undefined ? {} : { "X-Workspace-Id": workspaceId }),
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

before(async () => {
  await resource.db.insert(organization).values([org, otherOrg].map(id => ({ id, name: id, slug: id })));
  await resource.db.insert(user).values([uid, otherUid].map(id => ({ id, name: "Workspace acceptance", email: `${id}@local.test` })));
  await resource.db.insert(member).values([{ id: memberId, organizationId: org, userId: uid, role: "member" },
    { id: randomUUID(), organizationId: org, userId: otherUid, role: "member" }]);
  const all = await commands.listWorkspaces(deps, scope);
  a = { ...deps, workspaceId: all[0].id };
  b = { ...deps, workspaceId: (await commands.createWorkspace(deps, { ...scope, name: "B" })).id };
  foreignId = (await resource.db.select().from(workspaces).where(eq(workspaces.organizationId, otherOrg)))[0].id;
  actor = { kind: "human", userId: uid, memberId, organizationId: org, workspaceId: a.workspaceId,
    role: "member", name: "Fixture", email: `${uid}@local.test` };
  tableId = (await commands.createTable(a, { ...scope, name: "A confidential table" })).id;
  columnId = (await commands.getTable(a, { ...scope, tableId })).columns[0].id;
  rowId = (await commands.addRow(a, { ...scope, tableId, cells: { [columnId]: "A confidential row" } })).id;
  fileColumnId = (await commands.addColumn(a, { ...scope, tableId, name: "File", type: "file" })).id;
  fileId = randomUUID();
  await resource.db.insert(fileObjects).values({ id: fileId, organizationId: org, workspaceId: a.workspaceId,
    tableId, columnId: fileColumnId, name: "A confidential file", size: 4, mimeType: "text/plain", storageDriver: "local", storageKey: fileId });
  reportId = (await reportService.saveReport(a, { name: "A confidential report", description: "", columns: 2, widgets: [] }, org)).id;
  siteId = (await siteService.saveSite(a, { ...scope, name: "A confidential site", files: [{ path: "index.html", content: "<h1>A confidential source</h1>" }] })).id;
  threadId = (await threadService.createThread(a, actor, { clientId: randomUUID(), context: { page: "ai" } })).id;
  ruleId = (await commands.createAutomation(a, { ...scope, name: "A confidential schedule", source: { kind: "schedule", cron: "0 9 * * *", timeZone: "UTC" },
    trigger: { type: "schedule_due" }, actions: [{ type: "command", command: "addRow", input: { tableId, cells: {} } }] })).id;
});
after(async () => {
  const rules = await resource.db.select({ id: automations.id }).from(automations).where(eq(automations.organizationId, org));
  if (rules.length) await resource.db.delete(automationRuns).where(inArray(automationRuns.automationId, rules.map(rule => rule.id)));
  await resource.db.delete(automationEvents).where(eq(automationEvents.organizationId, org));
  await resource.db.delete(organization).where(inArray(organization.id, [org, otherOrg]));
  await resource.db.delete(user).where(inArray(user.id, [uid, otherUid]));
  await resource.close();
});

test("HTTP direct IDs hide A roots, children, files and scheduled/private history in B without effects", async () => {
  for (const path of [`/tables/${tableId}`, `/tables/${tableId}/rows`, `/reports/${reportId}`, `/reports/${reportId}/data`,
    `/sites/${siteId}`, `/threads/${threadId}`, `/threads/${threadId}/messages`, `/threads/${threadId}/runs`,
    `/automations/${ruleId}`, `/automations/${ruleId}/runs`, `/schedules/${ruleId}/runs`,
    `/files?ids=${fileId}`, `/files/${fileId}/download?workspace=${a.workspaceId}`]) {
    const response = await request(b.workspaceId, path);
    assert([400, 403, 404].includes(response.status), `${path}: ${response.status} ${await response.clone().text()}`);
    assert(!/A confidential/.test(await response.text()), path);
  }
  for (const [path, body, method] of [
    [`/tables/${tableId}`, { pinned: true }, "PATCH"],
    [`/reports/${reportId}`, undefined, "DELETE"],
    [`/sites/${siteId}`, undefined, "DELETE"],
    [`/threads/${threadId}`, { title: "B forged title" }, "PATCH"],
    [`/automations/${ruleId}`, { enabled: false }, "PATCH"],
  ] as const) assert((await request(b.workspaceId, path, body, method)).status >= 400, path);
  assert.equal((await commands.getTable(a, { ...scope, tableId })).pinned, false);
  assert.equal((await commands.getRow(a, { ...scope, rowId })).cells[columnId], "A confidential row");
  assert.equal((await reportService.getReport(a, reportId, org)).name, "A confidential report");
  assert.equal((await siteService.getSite(a, { ...scope, siteId })).name, "A confidential site");
  assert.equal((await threadService.getThread(a, actor, threadId)).title, null);
  assert.equal((await resource.db.select().from(automations).where(eq(automations.id, ruleId)))[0].enabled, true);
  assert.equal(storageCalls, 0);
});

test("header selection, controlled default, enterprise member list and private owners are enforced at HTTP", async () => {
  assert.equal((await request(a.workspaceId, `/files?ids=${fileId}`)).status, 200);
  assert.equal((await request(a.workspaceId, `/threads/${threadId}`, undefined, "GET", "fixture=peer")).status, 404);
  assert.equal((await request(a.workspaceId, "/tables", undefined, "GET", "")).status, 401);
  const defaultTables = await (await request(undefined, "/tables")).json();
  assert.deepEqual(defaultTables.map((table: { id: string }) => table.id), [tableId]);
  const membersA = await (await request(a.workspaceId, "/commands", { command: "listMembers" })).json();
  const membersB = await (await request(b.workspaceId, "/commands", { command: "listMembers" })).json();
  assert.deepEqual(membersA.result, membersB.result);
  assert.equal((await request(b.workspaceId, "/commands", { command: "getTable", input: { tableId, organizationId: otherOrg } })).status, 400);
  assert.equal((await request(b.workspaceId, "/commands", { command: "listTables", input: { workspaceId: a.workspaceId } })).status, 400);
  const create = await request(b.workspaceId, "/commands", { command: "createWorkspace", input: { name: "Human member can create" } });
  assert.equal(create.status, 200);
  assert.equal((await create.json()).result.organizationId, org);
});

test("invalid or foreign workspace selectors produce an authorization response on every resource route", async () => {
  const results: Record<string, number> = {};
  for (const [kind, invalid] of [["foreign", foreignId], ["missing", randomUUID()], ["empty", ""], ["malformed", "invalid"]])
    for (const path of ["/tables", "/reports", "/sites", "/threads", "/automations"])
      results[`${kind} ${path}`] = (await request(invalid, path)).status;
  assert.deepEqual(results, Object.fromEntries(Object.keys(results).map(key => [key, 403])));
});

test("deferred webhook target IDs are revalidated against the persisted rule workspace without mutation or receipt", async () => {
  const tableB = await commands.createTable(b, { ...scope, name: "Deferred target in B" });
  const [endpoint] = await resource.db.insert(webhookEndpoints).values({ organizationId: org, createdByUserId: uid,
    name: "Deferred target fixture", kind: "webhook" }).returning();
  const source = { kind: "webhook" as const, endpointId: endpoint.id };
  await commands.createAutomation(a, { ...scope, name: "A rule with deferred table", source, trigger: { type: "webhook_received" },
    actions: [{ type: "command", command: "addRow", input: { tableId: { $event: "payload.tableId" }, cells: {} } }] });
  const id = randomUUID();
  await resource.db.transaction(tx => appendExternalAutomationEvent(b, tx, { id, organizationId: org, source,
    type: "webhook_received", occurredAt: new Date().toISOString(), data: { payload: { tableId: tableB.id } }, traceId: id }));
  const worker = { ...b, runAgentAction: async () => { throw new Error("Unexpected native action"); } };
  const fence = await claimExecution(worker, id); assert(fence);
  await assert.rejects(executeNext(worker, id, fence), /不存在|工作区/);
  assert.equal((await resource.db.select().from(rows).where(eq(rows.tableId, tableB.id))).length, 0);
  const [run] = await resource.db.select().from(automationRuns).where(eq(automationRuns.eventId, id));
  assert.equal(run.workspaceId, a.workspaceId);
  assert.equal((await resource.db.select().from(automationStepReceipts).where(eq(automationStepReceipts.runId, run.id))).length, 0);
});

test("in-flight command waits for member revocation transaction then rejects the stale actor atomically", async () => {
  let release!: () => void, deleted!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const deletionStarted = new Promise<void>(resolve => { deleted = resolve; });
  const revocation = resource.db.transaction(async tx => {
    await tx.delete(member).where(eq(member.id, memberId));
    deleted(); await gate;
  });
  await deletionStarted;
  const outcome = dispatchCommand(a, actor, { command: "addRow", input: { tableId, cells: { [columnId]: "Revoked command must not commit" } } })
    .then(() => null, (error: unknown) => error);
  try {
    let blocked = false;
    for (let i = 0; i < 100; i++) {
      const active = await resource.db.execute(sql`select 1 from pg_stat_activity where datname=current_database()
        and wait_event_type='Lock' and query like '%from "member"%' and query like '%for share%'`);
      if (active.length) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert(blocked, "membership share-lock must wait for the real concurrent DELETE");
  } finally { release(); await revocation; }
  assert.match(String(await outcome), /不可访问/);
  assert.equal((await resource.db.select().from(rows).where(eq(rows.tableId, tableId))).length, 1);
  assert.equal((await request(a.workspaceId, "/tables")).status, 401);
  assert.equal((await resource.db.select().from(rows).where(eq(rows.id, rowId))).length, 1);
  assert.equal((await resource.db.select().from(chatThreads).where(eq(chatThreads.id, threadId))).length, 1);
});
