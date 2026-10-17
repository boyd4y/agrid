import { createSiteKey, listSiteKeys } from "../../src/business/data-api/keys.js";
import { resolveSiteKey } from "../../src/business/data-api/keys.js";
import { siteRows } from "../../src/business/data-api/data.js";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "../../src/business/db/factory.js";
import type { CommandDependencies } from "../../src/business/dependencies.js";
import type { Actor } from "../../src/business/auth/actor.js";
import { resolveActor } from "../../src/business/auth/actor.js";
import { dispatchCommand } from "../../src/business/services/command-dispatch.js";
import * as commands from "../../src/business/commands/index.js";
import * as reports from "../../src/business/reports/service.js";
import * as threads from "../../src/business/services/threads.js";
import { listFiles, downloadFile } from "../../src/business/services/files.js";
import { updateTableMetadata } from "../../src/business/services/tables.js";
import { appendExternalAutomationEvent } from "../../src/business/automation/events.js";
import { claimExecution, executeNext } from "../../src/business/automation/execution.js";
import { dispatchDueSchedules } from "../../src/business/automation/schedule.js";
import { organization, user, member, workspaces, tables, columns, rows, automations, automationEvents, automationRuns, automationSchedules, webhookEndpoints, fileObjects } from "../../src/business/db/schema.js";

const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test"));
const resource = createDatabase({ connectionString: url, poolMax: 6 });
const deps: CommandDependencies = { database: resource.db, now: () => new Date(), uuid: randomUUID, automationQueueName: "agrid-queue-test-workspace-commands" };
const org = randomUUID(), foreign = randomUUID(), uid = randomUUID(), membership = randomUUID();
let a: CommandDependencies, b: CommandDependencies, c: CommandDependencies, actor: Actor;
let tableA: string, tableB: string, rowA: string, rowB: string, columnA: string, columnB: string, viewA: string;
const scope = { organizationId: org, actorId: uid };
before(async () => {
  await resource.db.insert(organization).values([org, foreign].map(id => ({ id, name: "Workspace regression", slug: id })));
  await resource.db.insert(user).values({ id: uid, name: "Owner", email: `${uid}@local.test` });
  await resource.db.insert(member).values({ id: membership, organizationId: org, userId: uid, role: "owner" });
  const all = await commands.listWorkspaces(deps, scope);
  assert.equal(all.length, 1); assert(all[0].isDefault);
  const second = await commands.createWorkspace(deps, { ...scope, name: "B" });
  const [third] = await resource.db.select().from(workspaces).where(eq(workspaces.organizationId, foreign));
  a = { ...deps, workspaceId: all[0].id }; b = { ...deps, workspaceId: second.id }; c = { ...deps, workspaceId: third.id };
  actor = { kind: "human", userId: uid, memberId: membership, organizationId: org, workspaceId: a.workspaceId, role: "owner", name: "Owner", email: `${uid}@local.test` };
  tableA = (await commands.createTable(a, { ...scope, name: "Same name" })).id;
  tableB = (await commands.createTable(b, { ...scope, name: "Same name" })).id;
  columnA = (await commands.getTable(a, { ...scope, tableId: tableA })).columns[0].id;
  columnB = (await commands.getTable(b, { ...scope, tableId: tableB })).columns[0].id;
  rowA = (await commands.addRow(a, { ...scope, tableId: tableA, cells: { [columnA]: "A private" } })).id;
  rowB = (await commands.addRow(b, { ...scope, tableId: tableB, cells: { [columnB]: "B private" } })).id;
  viewA = (await commands.createGridView(a, { ...scope, tableId: tableA, name: "A view" })).id;
});
after(async () => {
  const rules = await resource.db.select({ id: automations.id }).from(automations).where(eq(automations.organizationId, org));
  if (rules.length) await resource.db.delete(automationRuns).where(inArray(automationRuns.automationId, rules.map(rule => rule.id)));
  await resource.db.delete(automationEvents).where(eq(automationEvents.organizationId, org));
  for (const id of [org, foreign]) await resource.db.delete(organization).where(eq(organization.id, id));
  await resource.db.delete(user).where(eq(user.id, uid)); await resource.close();
});
test("same-organization workspaces have isolated table systems and names; missing selector is default-only", async () => {
  assert.deepEqual((await commands.listTables(a, scope)).map(item => item.id), [tableA]);
  assert.deepEqual((await commands.listTables(b, scope)).map(item => item.id), [tableB]);
  assert.deepEqual((await commands.listTables(deps, scope)).map(item => item.id), [tableA]);
  await assert.rejects(commands.createTable(a, { ...scope, name: " same NAME " }), /同名/);
  await assert.rejects(commands.getTable(a, { tableId: tableA }), /组织上下文/);
  await assert.rejects(commands.updateCell(a, { rowId: rowA, columnId: columnA, value: "missing identity" }), /组织上下文/);
  await assert.rejects(commands.createTable(c, { ...scope, name: "forged" }), /工作区不可访问/);
  await updateTableMetadata(a, org, tableA, { pinned: true });
  assert.equal((await commands.listTables(a, scope))[0].pinned, true);
  assert.equal((await commands.listTables(b, scope))[0].pinned, false);
});
test("direct row/column/view/table IDs and mixed batches reject with no partial writes", async () => {
  const rejected = [
    () => commands.getTable(b, { ...scope, tableId: tableA }),
    () => commands.getRow(b, { ...scope, rowId: rowA }),
    () => commands.updateCell(b, { ...scope, rowId: rowA, columnId: columnA, value: "leak" }),
    () => commands.deleteRow(b, { ...scope, rowId: rowA }),
    () => commands.updateColumn(b, { ...scope, columnId: columnA, name: "leak" }),
    () => commands.getView(b, { ...scope, viewId: viewA }),
    () => commands.renameView(b, { ...scope, viewId: viewA, name: "leak" }),
    () => commands.deleteTable(b, { ...scope, tableId: tableA }),
    () => commands.batchUpdateRows(b, { ...scope, updates: [{ rowId: rowB, cells: { [columnB]: "partial" } }, { rowId: rowA, cells: { [columnA]: "leak" } }] }),
    () => commands.batchDeleteRows(b, { ...scope, rowIds: [rowB, rowA] }),
  ];
  for (const operation of rejected) await assert.rejects(operation());
  assert.equal((await commands.getRow(a, { ...scope, rowId: rowA })).cells[columnA], "A private");
  assert.equal((await commands.getRow(b, { ...scope, rowId: rowB })).cells[columnB], "B private");
  assert.equal(await updateTableMetadata(b, org, tableA, { pinned: false }), undefined);
});
test("cross-workspace relations and report widgets roll back; independent roots remain scoped", async () => {
  const before = await resource.db.select().from(columns).where(eq(columns.tableId, tableB));
  await assert.rejects(commands.addColumn(b, { ...scope, tableId: tableB, name: "Cross", type: "relation", config: { relation: { targetTableId: tableA, limit: "many", inverseName: "Inverse" } } }), /工作区/);
  assert.equal((await resource.db.select().from(columns).where(eq(columns.tableId, tableB))).length, before.length);
  const report = await reports.saveReport(a, { name: "A report", description: "", columns: 2, widgets: [] }, org);
  assert.equal((await reports.listReports(b, org)).reports.length, 0);
  await assert.rejects(reports.getReport(b, report.id, org), /报告不存在/);
  await assert.rejects(reports.saveReport(b, { name: "Bad widget", description: "", columns: 2, widgets: [{ id: randomUUID(), type: "metric", title: "secret", width: "full", query: { tableId: tableA, metric: "count", valueColumnId: null } }] }, org), /来源表格/);
});
test("form and board configuration cannot persist hidden field references from another workspace", async () => {
  const form = await commands.createFormView(a, { ...scope, tableId: tableA, name: "Local form", fields: [{ columnId: columnA }] });
  const original = await commands.getView(a, { ...scope, viewId: form.id });
  await assert.rejects(commands.updateFormView(a, { ...scope, viewId: form.id, name: "Must not save",
    config: { fields: [{ columnId: columnA }, { columnId: columnB }] } }), /列不属于该表/);
  assert.deepEqual(await commands.getView(a, { ...scope, viewId: form.id }), original);
  await assert.rejects(commands.setFormFields(a, { ...scope, viewId: form.id, fields: [{ columnId: columnB }] }), /列不属于该表/);
  const before = await commands.listViews(a, { ...scope, tableId: tableA });
  await assert.rejects(commands.createFormView(a, { ...scope, tableId: tableA, name: "Cross form", fields: [{ columnId: columnB }] }), /列不属于该表/);
  await assert.rejects(commands.createBoardView(a, { ...scope, tableId: tableA, name: "Cross board", config: { visibleColumnIds: [columnB] } }), /不属于该表/);
  assert.deepEqual(await commands.listViews(a, { ...scope, tableId: tableA }), before);
});
test("private chat client IDs and file metadata/bytes cannot escape workspace", async () => {
  const threadA = await threads.createThread(a, actor, { clientId: "same-client", context: { page: "ai" } });
  const threadB = await threads.createThread(b, { ...actor, workspaceId: b.workspaceId }, { clientId: "same-client", context: { page: "ai" } });
  assert.notEqual(threadA.id, threadB.id);
  await assert.rejects(threads.getThread(b, { ...actor, workspaceId: b.workspaceId }, threadA.id), /对话不存在/);
  const fileId = randomUUID();
  await resource.db.insert(fileObjects).values({ id: fileId, organizationId: org, workspaceId: a.workspaceId, tableId: tableA, columnId: columnA, name: "secret", size: 4, mimeType: "text/plain", storageDriver: "local", storageKey: fileId });
  await assert.rejects(listFiles(b, org, [fileId]), /文件不存在/);
  let storageTouched = false;
  await assert.rejects(downloadFile({ ...b, limits: { maxFiles: 1, maxFileBytes: 10, maxBodyBytes: 100 }, storage: () => { storageTouched = true; throw new Error("should not reach storage"); } }, org, fileId), /文件不存在/);
  assert.equal(storageTouched, false);
});
test("sites and explicit API key table capabilities keep enterprise management global", async () => {
  const siteCapabilities = { publicOrigin: "https://sites.local", apiOrigin: "https://api.local", appOrigin: "https://app.local", sdkUrl: "https://api.local/sdk.js", storageDriver: "local", storage: () => { throw new Error("No publication in this test"); } };
  const sitesA = { ...a, sites: siteCapabilities }, sitesB = { ...b, sites: siteCapabilities };
  const site = await commands.saveSite(sitesA, { ...scope, name: "A site", files: [{ path: "index.html", content: "<h1>A private source</h1>" }] });
  assert.equal((await commands.listSites(sitesB, scope)).length, 0);
  assert.equal((await commands.getSite(sitesA, { ...scope, siteId: site.id })).files[0].content, "<h1>A private source</h1>");
  await assert.rejects(commands.getSite(sitesB, { ...scope, siteId: site.id }), /Site not found/);
  await assert.rejects(commands.deleteSite(sitesB, { ...scope, siteId: site.id }), /Site not found/);
  const key = await createSiteKey(a, actor, { name: "Explicit A table", permissions: [{ tableId: tableA, canRead: true, canCreate: false, canUpdate: false, canDelete: false }] });
  const [globalA, globalB] = await Promise.all([listSiteKeys(a, actor), listSiteKeys(b, { ...actor, workspaceId: b.workspaceId })]);
  assert.deepEqual(globalA, globalB);
  assert.deepEqual(new Set(globalB.tables.map(table => table.workspaceId)), new Set([a.workspaceId, b.workspaceId]));
  const principal = await resolveSiteKey(resource.db, key.secret), context = { principal, secret: key.secret, baseUrl: "https://api.local" };
  assert.equal((await siteRows(b, context, tableA, {})).rows[0].cells[columnA], "A private");
  await assert.rejects(siteRows(a, context, tableB, {}), /Table not found/);
});
test("request identity validates selected workspace and command payload cannot replace trusted scope", async () => {
  const identity = { database: resource.db, resolveSession: async () => ({ user: { id: uid, name: "Owner", email: actor.email }, session: { activeOrganizationId: org } }) };
  assert.equal((await resolveActor(new Request("http://local", { headers: { "X-Workspace-Id": b.workspaceId! } }), identity))?.workspaceId, b.workspaceId);
  await assert.rejects(resolveActor(new Request("http://local", { headers: { "X-Workspace-Id": c.workspaceId! } }), identity), /工作区不可访问/);
  await assert.rejects(dispatchCommand(deps, actor, { command: "listTables", input: { workspaceId: b.workspaceId } }), /内部执行/);
  const result = await dispatchCommand(deps, { ...actor, workspaceId: b.workspaceId }, { command: "listTables" });
  assert.deepEqual((result.result as { id: string }[]).map(item => item.id), [tableB]);
  assert.deepEqual((await commands.listMembers(a, scope)).members.map(item => item.id), (await commands.listMembers(b, scope)).members.map(item => item.id));
});
test("enterprise ingress fans out into fixed rule scopes; switching dispatch dependencies cannot move writes", async () => {
  const [endpoint] = await resource.db.insert(webhookEndpoints).values({ organizationId: org, createdByUserId: uid, kind: "webhook", name: "Shared enterprise endpoint", tokenHash: randomUUID() }).returning();
  const source = { kind: "webhook" as const, endpointId: endpoint.id };
  for (const [bound, tableId] of [[a, tableA], [b, tableB]] as const) await commands.createAutomation(bound, { ...scope, name: "Own destination", source, trigger: { type: "webhook_received" }, actions: [{ type: "command", command: "addRow", input: { tableId } }] });
  await assert.rejects(commands.createAutomation(b, { ...scope, name: "Invalid cross destination", source, trigger: { type: "webhook_received" }, actions: [{ type: "command", command: "addRow", input: { tableId: tableA } }] }), /表格不存在/);
  const id = randomUUID();
  await resource.db.transaction(tx => appendExternalAutomationEvent(b, tx, { id, organizationId: org, source, type: "webhook_received", occurredAt: new Date().toISOString(), data: {}, traceId: id }));
  const saved = await resource.db.select().from(automationRuns).where(eq(automationRuns.eventId, id));
  assert.equal(saved.length, 2); assert.deepEqual(new Set(saved.map(run => run.workspaceId)), new Set([a.workspaceId, b.workspaceId]));
  const worker = { ...b, runAgentAction: async () => { throw new Error("No native action"); } };
  const fence = await claimExecution(worker, id); assert(fence);
  for (let i = 0; i < 6; i++) if (await executeNext(worker, id, fence) === "done") break;
  assert.equal((await commands.queryRows(a, { ...scope, tableId: tableA })).rows.length, 2);
  assert.equal((await commands.queryRows(b, { ...scope, tableId: tableB })).rows.length, 2);
  const rule = await commands.createAutomation(a, { ...scope, name: "Fixed schedule", source: { kind: "schedule", cron: "0 * * * *", timeZone: "UTC" }, trigger: { type: "schedule_due" }, actions: [{ type: "command", command: "addRow", input: { tableId: tableA } }] });
  await resource.db.update(automationSchedules).set({ nextRunAt: new Date(0) }).where(eq(automationSchedules.automationId, rule.id));
  await dispatchDueSchedules(b, new Date(), 25, org);
  const [scheduled] = await resource.db.select().from(automationRuns).where(eq(automationRuns.automationId, rule.id));
  assert.equal(scheduled.workspaceId, a.workspaceId);
});
