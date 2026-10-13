import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
if (!process.env.DATABASE_URL?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
const { db, client } = await import("../../src/db/index.js");
const { organization, member, session, user, rows, columns, automations } = await import("../../src/db/schema.js");
const { auth } = await import("../../src/auth/index.js");
const { createTable, addColumn, addRow, updateCell } = await import("../../src/commands/index.js");
const service = await import("../../src/reports/service.js");
const crud = await import("../../src/automation/crud.js");
const { reportsRoute, reportErrorResponse } = await import("../../src/routes/reports.js");
const { automationsRoute } = await import("../../src/routes/automations.js");
const app = new Hono().route("/api/reports", reportsRoute).route("/api", automationsRoute);
app.onError((error, c) => c.json({ error: error.message }, error.name === "ZodError" ? 400 : 500));
const org = randomUUID(), foreignOrg = randomUUID();let tableId = "", foreignTableId = "", groupId = "", valueId = "", dateId = "", cookie = "", userId = "", reportId = "", rowId = "";
const req = (path: string, body?: unknown, method = "GET", authCookie = cookie) => app.request(`http://localhost:3001/api${path}`, { method, headers: { Cookie: authCookie, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const config = (metric: "count" | "sum" | "average" = "count") => ({ name: "Sales report", tableId, chartType: "bar" as const, groupColumnId: groupId, metric, valueColumnId: metric === "count" ? null : valueId, dateBucket: "month" as const });
before(async () => {
  const response = await auth.handler(new Request("http://localhost:3001/api/auth/sign-up/email", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" }, body: JSON.stringify({ email: `reports-${randomUUID()}@local.test`, password: "Test-report-password-123!", name: "Report Test" }) }));
  assert.equal(response.status, 200);userId = (await response.json()).user.id;cookie = response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
  await db.insert(organization).values([{ id: org, name: "Report workspace", slug: org }, { id: foreignOrg, name: "Foreign report workspace", slug: foreignOrg }]);
  await db.insert(member).values({ id: randomUUID(), userId, organizationId: org, role: "owner" });
  await db.update(session).set({ activeOrganizationId: org }).where(eq(session.userId, userId));
  tableId = (await createTable({ organizationId: org, name: "Sales" })).id;
  foreignTableId = (await createTable({ organizationId: foreignOrg, name: "Secret" })).id;
  groupId = (await addColumn({ organizationId: org, tableId, name: "Status", type: "select", config: { options: [{ id: "todo", label: "待办", color: "gray" }, { id: "done", label: "完成", color: "green" }] } })).id;
  valueId = (await addColumn({ organizationId: org, tableId, name: "Amount", type: "number" })).id;
  dateId = (await addColumn({ organizationId: org, tableId, name: "Date", type: "date" })).id;
  const first = await addRow({ organizationId: org, tableId, cells: { [groupId]: "todo", [valueId]: 10, [dateId]: "2026-10-01" } });rowId = first.id;
  await addRow({ organizationId: org, tableId, cells: { [groupId]: "todo", [valueId]: 30, [dateId]: "2026-10-20" } });
  await addRow({ organizationId: org, tableId, cells: { [groupId]: "done", [valueId]: null, [dateId]: "2026-11-01" } });
});
after(async () => { await db.delete(organization).where(eq(organization.id, org));await db.delete(organization).where(eq(organization.id, foreignOrg));if (userId) await db.delete(user).where(eq(user.id, userId));await client.end(); });

test("real report aggregates use the entire source, option labels and null-aware numeric metrics", async () => {
  const count = await service.queryReport(config(), org);assert.equal(count.totalRows, 3);assert.equal(count.points.find((p) => p.key === "todo")?.value, 2);assert.equal(count.points.find((p) => p.key === "done")?.label, "完成");
  const sum = await service.queryReport(config("sum"), org);assert.equal(sum.points.find((p) => p.key === "todo")?.value, 40);assert.equal(sum.points.find((p) => p.key === "done")?.value, null);
  const average = await service.queryReport(config("average"), org);assert.equal(average.points.find((p) => p.key === "todo")?.value, 20);
  const dates = await service.queryReport({ ...config(), groupColumnId: dateId }, org);assert.deepEqual(dates.points.map((p) => [p.label, p.value]), [["2026-10", 2], ["2026-11", 1]]);
});

test("configuration persists through HTTP CRUD and reads fresh values after a mutation", async () => {
  const created = await req("/reports", config("sum"), "POST");assert.equal(created.status, 201);reportId = (await created.json()).id;
  const restored = await (await req(`/reports/${reportId}`)).json();assert.equal(restored.widgets[0].query.groupColumnId, groupId);assert.equal(restored.widgets[0].query.metric, "sum");
  await updateCell({ organizationId: org, rowId, columnId: valueId, value: 50 });
  const fresh = await (await req(`/reports/${reportId}/data`)).json();assert.equal(fresh.widgets[0].data.points.find((p: { key: string }) => p.key === "todo").value, 80);
  const page = { name: restored.name, description: restored.description, columns: restored.columns, widgets: restored.widgets.map((w: any) => ({ ...w, query: { ...w.query, chartType: "line" } })) };
  assert.equal((await req(`/reports/${reportId}`, { ...page, expectedVersion: restored.version }, "PATCH")).status, 200);
  assert.equal((await req(`/reports/${reportId}`, { ...page, expectedVersion: restored.version }, "PATCH")).status, 409);
  const listed = await (await req("/reports")).json();assert.equal(listed.reports.length, 1);assert.equal(listed.reports[0].widgets[0].query.chartType, "line");
});

test("report source, fields and CRUD are tenant scoped and require authentication", async () => {
  assert.equal((await req("/reports", undefined, "GET", "")).status, 401);
  await assert.rejects(service.queryReport({ ...config(), tableId: foreignTableId }, org), /表格不存在/);
  await assert.rejects(service.queryReport({ ...config(), groupColumnId: valueId }, org), /分组字段/);
  await assert.rejects(service.queryReport({ ...config("sum"), valueColumnId: groupId }, org), /数字字段/);
  await assert.rejects(service.getReport(reportId, foreignOrg), /报告不存在/);
  await assert.rejects(service.deleteReport(reportId, foreignOrg), /报告不存在/);
  assert.equal((await req("/reports", { ...config(), unexpected: "ignored?" }, "POST")).status, 400);
  const invalid = await req("/reports/preview", { ...config(), groupColumnId: valueId }, "POST");
  assert.equal(invalid.status, 400);assert.match((await invalid.json()).error, /分组字段/);
});

test("unexpected server failures do not expose SQL, parameters or internal errors", async () => {
  const broken = new Hono().onError(reportErrorResponse).get("/", () => { throw new Error("Failed query: select cells from rows params: private-table-id"); });
  const originalLog = console.error;const logs: unknown[][] = [];
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    const response = await broken.request("http://localhost/");assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "报告暂时无法加载，请稍后重试" });assert.equal(logs.length, 1);
  } finally { console.error = originalLog; }
});

test("deleted report fields fail visibly and deleting a report preserves source rows", async () => {
  const temporary = await addColumn({ organizationId: org, tableId, name: "Temporary", type: "text" });
  const report = await service.saveReport({ ...config(), groupColumnId: temporary.id }, org);
  await db.delete(columns).where(eq(columns.id, temporary.id));
  const stored = await service.getReport(report.id, org);const result = await service.queryReportPage({ name: stored.name, description: stored.description, columns: stored.columns, widgets: stored.widgets }, org);assert.match(result.widgets[0].error!, /分组字段/);
  assert.equal((await req(`/reports/${reportId}`, undefined, "DELETE")).status, 200);assert.equal((await req(`/reports/${reportId}`)).status, 404);
  assert.equal((await db.select().from(rows).where(eq(rows.tableId, tableId))).length, 3);
});

test("independent automation listing and direct detail never expose a foreign source", async () => {
  const rule = await crud.createAutomation({ organizationId: org, tableId, name: "Independent automation", trigger: { type: "row_created" }, actions: [{ type: "update_field", columnId: groupId, value: "done" }] });
  const foreign = await crud.createAutomation({ organizationId: foreignOrg, tableId: foreignTableId, name: "Secret rule", trigger: { type: "row_created" }, actions: [{ type: "run_agent" }] });
  const list = await (await req("/automations")).json();assert.equal(list.rules.length, 1);assert.equal(list.rules[0].id, rule.id);assert.equal(list.rules[0].sourceName, "Sales");
  assert.equal((await req(`/automations/${rule.id}`)).status, 200);assert.equal((await req(`/automations/${foreign.id}`)).status, 404);
  await assert.rejects(crud.createAutomation({ organizationId: org, tableId: foreignTableId, name: "Forged source", trigger: { type: "row_created" }, actions: [{ type: "run_agent" }] }), /表格不存在/);
  await crud.deleteAutomation({ organizationId: org, automationId: rule.id });assert.equal((await req(`/automations/${rule.id}`)).status, 404);
  assert.equal((await (await req("/automations")).json()).rules.length, 0);
});

test("agent report tools build a multi-widget page, serialize edits and share real data", async () => {
  const { createTableTools } = await import("../../src/ai/tools.js");
  const tools = createTableTools(undefined, org, userId), options = { toolCallId: "report-tool-test", messages: [] };
  const created = await tools.create_report.execute({ name: "Agent report page", description: "Sales overview", columns: 2 }, options);
  const chartId = randomUUID(), metricId = randomUUID(), textId = randomUUID();
  await Promise.all([
    tools.add_report_widget.execute({ reportId: created.id, widget: { id: chartId, title: "By status", width: "half", type: "chart", query: { tableId, chartType: "bar", groupColumnId: groupId, metric: "count", valueColumnId: null, dateBucket: "month" } } }, options).catch((error: unknown) => { throw error; }),
    tools.add_report_widget.execute({ reportId: created.id, widget: { id: metricId, title: "Total", width: "half", type: "metric", query: { tableId, metric: "sum", valueColumnId: valueId } } }, options),
  ]);
  await tools.add_report_widget.execute({ reportId: created.id, widget: { id: textId, title: "Notes", width: "full", type: "text", content: "Actual table data" } }, options);
  const restored = await tools.get_report.execute({ reportId: created.id }, options);assert.equal(restored.widgets.length, 3);assert.equal(restored.version, 4);
  const data = await tools.get_report_data.execute({ reportId: created.id }, options);
  assert.equal(data.widgets.find((w: any) => w.id === metricId).data.value, 80);
  await tools.reorder_report_widgets.execute({ reportId: created.id, widgetIds: [textId, metricId, chartId] }, options);
  await tools.update_report_widget.execute({ reportId: created.id, widgetId: textId, widget: { id: textId, type: "text", title: "Updated notes", content: "Updated by tool", width: "full" } }, options);
  const updated = await tools.get_report.execute({ reportId: created.id }, options);assert.deepEqual(updated.widgets.map((w: any) => w.id), [textId, metricId, chartId]);assert.equal(updated.widgets[0].content, "Updated by tool");
  await assert.rejects(tools.reorder_report_widgets.execute({ reportId: created.id, widgetIds: [textId, textId, chartId] }, options), /全部组件/);
  const foreignTools = createTableTools(undefined, foreignOrg);
  await assert.rejects(foreignTools.get_report.execute({ reportId: created.id }, options), /报告不存在/);
  await assert.rejects(tools.add_report_widget.execute({ reportId: created.id, widget: { id: randomUUID(), type: "metric", title: "Secret", width: "full", query: { tableId: foreignTableId, metric: "count", valueColumnId: null } } }, options), /表格不存在/);
  await tools.delete_report_widget.execute({ reportId: created.id, widgetId: chartId }, options);
  assert.equal((await tools.get_report.execute({ reportId: created.id }, options)).widgets.length, 2);
  await tools.delete_report.execute({ reportId: created.id }, options);
  await assert.rejects(tools.get_report.execute({ reportId: created.id }, options), /报告不存在/);
});

test("report context is verified on the server and never binds an arbitrary table", async () => {
  const { resolveChatContext } = await import("../../src/chat/context.js");
  const report = await service.saveReport({ name: "Report context", description: "", columns: 2, widgets: [] }, org);
  const actor = { kind: "human" as const, organizationId: org, userId, memberId: "test-member", role: "owner", name: "Report Test", email: "context@local.test" };
  const context = await resolveChatContext({ page: "reports", reportId: report.id }, actor);
  assert.equal(context.resourceKey, `report:${report.id}`);assert.match(context.system, /当前报告的已保存版本/);assert.match(context.system, /当前页面没有绑定任何表格/);
  await assert.rejects(resolveChatContext({ page: "ai", reportId: report.id }, actor), /不应绑定报告/);
  await assert.rejects(resolveChatContext({ page: "reports", reportId: report.id }, { ...actor, organizationId: foreignOrg }), /不属于当前工作区/);
  await service.deleteReport(report.id, org);
});

test("reports bound large grouping output while preserving the total row count", async () => {
  const group = await addColumn({ organizationId: org, tableId, name: "Many groups", type: "text" });
  await db.insert(rows).values(Array.from({ length: 205 }, (_, i) => ({ tableId, cells: { [group.id]: `Group-${String(i).padStart(3, "0")}` }, sortOrder: i + 3 })));
  const data = await service.queryReport({ ...config(), groupColumnId: group.id }, org);assert.equal(data.points.length, 200);assert.equal(data.truncated, true);assert.equal(data.totalRows, 208);
  const records = await db.select().from(automations).where(eq(automations.tableId, tableId));assert.equal(records.length, 1);
});

test("dashboard layout survives reload, atomic tool edits and rejects overlap or out-of-bounds", async () => {
  const a = randomUUID(), b = randomUUID();
  const created = await service.saveReport({ name: "Dashboard", description: "", columns: 2, widgets: [
    { id: a, type: "metric", title: "Total", width: "half", layout: { x: 0, y: 0, w: 4, h: 4 }, query: { tableId, metric: "count", valueColumnId: null } },
    { id: b, type: "text", title: "Notes", width: "half", layout: { x: 4, y: 0, w: 8, h: 6 }, content: "Persist me" },
  ] }, org);
  assert.deepEqual((await service.getReport(created.id, org)).widgets[1].layout, { x: 4, y: 0, w: 8, h: 6 });
  const { createReportTools } = await import("../../src/ai/report-tools.js");const tools = createReportTools(org) as Record<string, any>;
  const options = { toolCallId: "dashboard", messages: [] };
  await tools.set_report_layout.execute({ reportId: created.id, widgets: [{ id: a, layout: { x: 0, y: 0, w: 12, h: 5 } }, { id: b, layout: { x: 0, y: 5, w: 6, h: 4 } }] }, options);
  const restored = await service.getReport(created.id, org);assert.deepEqual(restored.widgets[0].layout, { x: 0, y: 0, w: 12, h: 5 });
  assert.equal(restored.widgets[1].type === "text" && restored.widgets[1].content, "Persist me");
  await assert.rejects(tools.set_report_layout.execute({ reportId: created.id, widgets: [{ id: a, layout: { x: 0, y: 0, w: 12, h: 5 } }, { id: b, layout: { x: 0, y: 3, w: 6, h: 4 } }] }, options), /不能重叠/);
  await assert.rejects(tools.set_report_layout.execute({ reportId: created.id, widgets: [{ id: a, layout: { x: 8, y: 0, w: 6, h: 5 } }, { id: b, layout: { x: 0, y: 5, w: 6, h: 4 } }] }, options), /12 列/);
  await assert.rejects(tools.set_report_layout.execute({ reportId: created.id, widgets: [{ id: a, layout: { x: 0, y: 0, w: 6, h: 4 } }] }, options), /全部组件/);
  assert.equal((await service.getReport(created.id, org)).version, restored.version);
  const foreignTools = createReportTools(foreignOrg) as Record<string, any>;
  await assert.rejects(foreignTools.set_report_layout.execute({ reportId: created.id, widgets: [] }, options), /报告不存在/);
  const invalid = { name: restored.name, description: restored.description, columns: restored.columns, widgets: restored.widgets.map((w) => ({ ...w, layout: { x: 0, y: 0, w: 6, h: 4 } })), expectedVersion: restored.version };
  assert.equal((await req(`/reports/${created.id}`, invalid, "PATCH")).status, 400);
  const { resolveReportLayout, reportLayoutsOverlap } = await import("@tabdo/shared");
  const legacy = { name: "Legacy", description: "", columns: 2 as const, widgets: restored.widgets.map(({ layout, ...w }) => w) };
  const positions = resolveReportLayout(legacy);assert.equal(reportLayoutsOverlap(positions[0], positions[1]), false);
  await service.deleteReport(created.id, org);
});

test("all supported chart families persist and use the same real aggregates", async () => {
  const { REPORT_CHART_TYPES } = await import("@tabdo/shared");
  for (const chartType of REPORT_CHART_TYPES) {
    const page = await service.saveReport({ ...config("sum"), chartType }, org);
    assert.equal(page.widgets[0].type === "chart" && page.widgets[0].query.chartType, chartType);
    const { name, description, columns: pageColumns, widgets } = page;const data = await service.queryReportPage({ name, description, columns: pageColumns, widgets }, org);assert.equal((data.widgets[0].data as any).points.find((p: any) => p.key === "todo").value, 80);
    await service.deleteReport(page.id, org);
  }
  assert.equal((await req("/reports", { ...config(), chartType: "not-a-chart" }, "POST")).status, 400);
});
