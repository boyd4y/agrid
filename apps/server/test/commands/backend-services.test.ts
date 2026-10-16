import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "../../src/business/db/factory.js";
import type { CommandDependencies } from "../../src/business/dependencies.js";
import type { FormViewConfig } from "@tabdo/shared";
import { ServiceError } from "../../src/business/errors.js";
import { getDatabase } from "../../src/resources/scope.js";
import { organization, automations, automationEvents, automationOutbox, automationRuns } from "../../src/business/db/schema.js";
import * as commands from "../../src/business/commands/index.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString || !new URL(connectionString).pathname.endsWith("_agent_test")) {
  throw new Error("Backend service fixtures require an isolated *_agent_test database");
}
const resource = createDatabase({ connectionString, poolMax: 4 });
const org = randomUUID(), other = randomUUID();
const ruleIds: string[] = [];
const time = new Date("2026-10-15T02:03:04.000Z"), eventIds: string[] = [];
const deps: CommandDependencies = Object.freeze({
  database: resource.db,
  now: () => new Date(time),
  uuid: () => { const id = randomUUID(); eventIds.push(id); return id; },
  automationQueueName: `backend-fixture-${randomUUID()}`,
});
before(async () => {
  await resource.db.insert(organization).values([
    { id: org, name: "Explicit backend", slug: org },
    { id: other, name: "Explicit backend peer", slug: other },
  ]);
});
after(async () => {
  // Runs intentionally survive product rule/organization deletion.
  if (ruleIds.length) await resource.db.delete(automationRuns).where(inArray(automationRuns.automationId, ruleIds));
  await resource.db.delete(organization).where(eq(organization.id, org));
  await resource.db.delete(organization).where(eq(organization.id, other));
  await resource.close();
});

test("backend commands need only explicit dependencies, without HTTP/auth/ALS composition", async () => {
  assert.throws(() => getDatabase(), /resource|scope/i, "there is deliberately no application request scope");
  const [a, b] = await Promise.all([
    commands.createTable(deps, { organizationId: org, name: "Same scoped name" }),
    commands.createTable(deps, { organizationId: other, name: "Same scoped name" }),
  ]);
  const [first, second] = await Promise.all([
    commands.listTables(deps, { organizationId: org }),
    commands.listTables(deps, { organizationId: other }),
  ]);
  assert(first.some(table => table.id === a.id)); assert(!first.some(table => table.id === b.id));
  assert(second.some(table => table.id === b.id)); assert(!second.some(table => table.id === a.id));
  await assert.rejects(commands.getTable(deps, { organizationId: org, tableId: b.id }), /表格不存在/);
  await assert.rejects(commands.createTable(deps, { organizationId: org, name: " SAME SCOPED NAME " }),
    (error: unknown) => error instanceof ServiceError && error.status === 409);
});

test("row mutation, injected clock/UUID and outbox queue are committed with the caller transaction", async () => {
  const table = await commands.createTable(deps, { organizationId: org, name: "Explicit event resources" });
  const column = (await commands.getTable(deps, { organizationId: org, tableId: table.id })).columns[0];
  const [rule] = await resource.db.insert(automations).values({ organizationId: org, tableId: table.id,
    source: { kind: "table", tableId: table.id }, name: "Explicit event", trigger: { type: "row_created" },
    actions: [{ type: "update_field", columnId: column.id, value: "Result" }] }).returning({ id: automations.id });
  ruleIds.push(rule.id);
  await assert.rejects(resource.db.transaction(async tx => {
    await commands.addRow(deps, { organizationId: org, tableId: table.id, cells: { [column.id]: "Roll back" } }, tx);
    throw new Error("receipt failed");
  }), /receipt failed/);
  assert.equal((await commands.queryRows(deps, { organizationId: org, tableId: table.id })).rows.length, 0);
  assert.equal((await resource.db.select().from(automationEvents).where(eq(automationEvents.tableId, table.id))).length, 0);
  const row = await resource.db.transaction(tx => commands.addRow(deps,
    { organizationId: org, tableId: table.id, cells: { [column.id]: "Commit" } }, tx));
  const updated = await commands.updateCell(deps, { organizationId: org, rowId: row.id, columnId: column.id, value: "Updated" });
  assert.equal(updated.updatedAt.toISOString(), time.toISOString());
  const [event] = await resource.db.select().from(automationEvents).where(eq(automationEvents.tableId, table.id));
  assert(eventIds.includes(event.id));
  const [outbox] = await resource.db.select().from(automationOutbox).where(eq(automationOutbox.eventId, event.id));
  assert.equal(outbox.queue, deps.automationQueueName);
});

test("table deletion and form chrome now share the caller transaction and roll back together", async () => {
  const table = await commands.createTable(deps, { organizationId: org, name: "Explicit transaction deletion" });
  const form = await commands.createFormView(deps, { organizationId: org, tableId: table.id, name: "Form" });
  await assert.rejects(resource.db.transaction(async tx => {
    await commands.setFormChrome(deps, { organizationId: org, viewId: form.id, title: "Transient" }, tx);
    assert.equal(((await commands.getView(deps, { organizationId: org, viewId: form.id }, tx)).config as FormViewConfig).title, "Transient");
    await commands.deleteTable(deps, { organizationId: org, tableId: table.id }, tx);
    throw new Error("caller receipt failed");
  }), /caller receipt failed/);
  assert.equal((await commands.getTable(deps, { organizationId: org, tableId: table.id })).id, table.id);
  assert.equal(((await commands.getView(deps, { organizationId: org, viewId: form.id })).config as FormViewConfig).title, form.config.title);
});
