import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { getToolTransaction } from "../../src/ai/execution-context.js";

if (!process.env.DATABASE_URL?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
// A nested checkout would stall every tool below.
process.env.DB_POOL_MAX = "1";
const { db, client } = await import("../../src/db/index.js");
const { organization, user, member, chatThreads } = await import("../../src/db/schema.js");
const cmds = await import("../../src/commands/index.js");
const reports = await import("../../src/reports/service.js");
const { createTableTools } = await import("../../src/ai/tools.js");
const { nativeHostTools } = await import("../../src/harness/tools.js");
const { claimRuntimeLease, withRuntimeLease } = await import("../../src/harness/store.js");

test("host reads, writes, batches and report validation share the lease connection and rollback", { timeout: 15000 }, async () => {
  const org = randomUUID(), owner = randomUUID();
  try {
    await db.insert(organization).values({ id: org, name: "Lease tools", slug: org });
    await db.insert(user).values({ id: owner, name: "Owner", email: `${owner}@local.test` });
    await db.insert(member).values({ id: randomUUID(), userId: owner, organizationId: org, role: "owner" });
    const [thread] = await db.insert(chatThreads).values({ userId: owner, organizationId: org, clientId: randomUUID(), custom: { resourceKey: "workspace" } }).returning();
    const actor = { kind: "human" as const, userId: owner, organizationId: org, memberId: "fixture", role: "owner", name: "Owner", email: `${owner}@local.test` };
    const lease = await claimRuntimeLease(thread.id, actor);
    const table = await cmds.createTable({ organizationId: org, name: "Source" });
    const title = (await cmds.getTable({ organizationId: org, tableId: table.id })).columns[0].id;
    const row = await cmds.addRow({ organizationId: org, tableId: table.id, cells: { [title]: "before" } });
    const report = await reports.saveReport({ name: "Report", description: "", columns: 2, widgets: [] }, org);
    let rollback = false;
    const hosted = nativeHostTools(createTableTools(table.id, org, owner), execute => withRuntimeLease(lease, async tx => {
      const result = await execute(tx);
      if (rollback) throw new Error("deliberate rollback");
      return result;
    }), actor);
    const call = (name: string, input: unknown) => hosted.tools[name].execute!(input, { toolCallId: randomUUID(), messages: [], context: undefined });
    await call("update_cell", { rowId: row.id, columnId: title, value: "after" });
    assert.equal((await call("get_row", { rowId: row.id }) as any).cells[title], "after");
    await call("query_rows", { tableId: table.id, includeTotal: true });
    await call("get_table", { tableId: table.id });
    await call("get_workspace", {});
    await call("list_members", {});
    await call("list_tables", {});
    const view = await call("create_form_view", { name: "Form" }) as any;
    await call("get_view", { viewId: view.id });
    await call("update_form_view", { viewId: view.id, title: "Updated" });
    await call("list_views", { tableId: table.id });
    await call("set_default_view", { viewId: view.id });
    await call("list_automations", {});
    await call("list_automation_runs", {});
    await call("batch_add_rows", { rows: [{ cells: { [title]: "batch" } }] });
    await call("add_report_widget", { reportId: report.id, widget: { type: "metric", title: "Count", width: "half", query: { tableId: table.id, metric: "count", valueColumnId: null } } });
    const data = await call("get_report_data", { reportId: report.id }) as any;
    assert.equal(data.widgets[0].data.totalRows, 2);
    await call("list_reports", {});
    await call("create_report", { name: "Created" });
    rollback = true;
    await assert.rejects(call("update_cell", { rowId: row.id, columnId: title, value: "rolled back" }), /deliberate rollback/);
    assert.equal((await cmds.getRow({ organizationId: org, rowId: row.id })).cells[title], "after");
    await assert.rejects(call("update_report", { reportId: report.id, name: "Rolled back" }), /deliberate rollback/);
    assert.equal((await reports.getReport(report.id, org)).name, "Report");
    rollback = false;
    await db.delete(member).where(eq(member.userId, owner));
    await assert.rejects(call("update_cell", { rowId: row.id, columnId: title, value: "revoked" }), /成员资格已撤销/);
    await assert.rejects(call("batch_add_rows", { rows: [{ cells: { [title]: "revoked" } }] }), /成员资格已撤销/);
    await assert.rejects(call("update_report", { reportId: report.id, name: "Revoked" }), /成员资格已撤销/);
    assert.equal((await cmds.getRow({ organizationId: org, rowId: row.id })).cells[title], "after");
    assert.equal((await cmds.queryRows({ organizationId: org, tableId: table.id })).rows.length, 2);
    assert.equal((await reports.getReport(report.id, org)).name, "Report");
    assert.equal(getToolTransaction(), undefined, "host context does not escape to model/provider work");
  } finally {
    await db.delete(organization).where(eq(organization.id, org));
    await db.delete(user).where(eq(user.id, owner));
    await client.end();
  }
});
