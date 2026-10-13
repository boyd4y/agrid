import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { asc, eq, inArray, or } from "drizzle-orm";
import type { Transaction } from "../../src/db/index.js";

if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith("_agent_test"))
  throw new Error("Use a dedicated *_agent_test database");
const { db, client } = await import("../../src/db/index.js");
const { organization, tables, columns, rows, tableRelations, rowRelations, automations,
  automationEvents, automationRuns, automationOutbox, automationStepReceipts } = await import("../../src/db/schema.js");
const commands = await import("../../src/commands/index.js");
const org = randomUUID(), scope = { organizationId: org };
const tableIds: string[] = [];
before(async () => { await db.insert(organization).values({ id: org, name: "Transaction composition", slug: org }); });
after(async () => {
  if (tableIds.length) await db.delete(automationRuns).where(inArray(automationRuns.tableId, tableIds));
  await db.delete(automationEvents).where(eq(automationEvents.organizationId, org));
  await db.delete(organization).where(eq(organization.id, org));
  await client.end();
});
async function table(name: string) {
  const created = await commands.createTable({ ...scope, name });
  tableIds.push(created.id);
  return { id: created.id, title: (await commands.getTable({ ...scope, tableId: created.id })).columns[0].id };
}
async function receiptRun(tableId: string, rowId: string) {
  const [run] = await db.insert(automationRuns).values({ automationId: randomUUID(), tableId, rowId,
    triggerType: "row_created", status: "running" }).returning();
  return run.id;
}
async function snapshot() {
  return {
    tables: await db.select().from(tables).where(eq(tables.organizationId, org)).orderBy(asc(tables.id)),
    columns: await db.select().from(columns).where(inArray(columns.tableId, tableIds)).orderBy(asc(columns.id)),
    rows: await db.select().from(rows).where(inArray(rows.tableId, tableIds)).orderBy(asc(rows.id)),
    definitions: await db.select().from(tableRelations).where(or(inArray(tableRelations.sourceTableId, tableIds), inArray(tableRelations.targetTableId, tableIds))).orderBy(asc(tableRelations.id)),
    edges: await db.select().from(rowRelations).innerJoin(rows, eq(rowRelations.sourceRowId, rows.id)).where(inArray(rows.tableId, tableIds)).orderBy(asc(rowRelations.relationId), asc(rowRelations.sourceRowId), asc(rowRelations.targetRowId)),
    events: await db.select().from(automationEvents).where(eq(automationEvents.organizationId, org)).orderBy(asc(automationEvents.id)),
    outbox: await db.select().from(automationOutbox).innerJoin(automationEvents, eq(automationOutbox.eventId, automationEvents.id)).where(eq(automationEvents.organizationId, org)).orderBy(asc(automationOutbox.id)),
    runs: await db.select().from(automationRuns).where(inArray(automationRuns.tableId, tableIds)).orderBy(asc(automationRuns.id)),
    receipts: await db.select().from(automationStepReceipts).innerJoin(automationRuns, eq(automationStepReceipts.runId, automationRuns.id)).where(inArray(automationRuns.tableId, tableIds)).orderBy(asc(automationStepReceipts.runId), asc(automationStepReceipts.step)),
  };
}
/** A receipt failure must undo every earlier business write in the caller's transaction. */
async function compose(runId: string, work: (tx: Transaction) => Promise<Record<string, unknown>>) {
  const initial = await snapshot();
  const execute = (rollback = false) => db.transaction(async tx => {
    const result = await work(tx);
    await tx.insert(automationStepReceipts).values({ runId, step: 0, result });
    await tx.update(automationRuns).set({ nextStep: 1 }).where(eq(automationRuns.id, runId));
    if (rollback) throw new Error("caller transaction deliberately rolls back");
    return result;
  });
  await assert.rejects(execute(true), /caller transaction deliberately rolls back/);
  assert.deepEqual(await snapshot(), initial, "data, inverses, computed values, events, receipts and progress all roll back");
  const result = await execute();
  const receipt = await db.select().from(automationStepReceipts).where(eq(automationStepReceipts.runId, runId));
  assert.equal(receipt.length, 1);
  assert.deepEqual(receipt[0].result, result);
  assert.equal((await db.select().from(automationRuns).where(eq(automationRuns.id, runId)))[0].nextStep, 1);
  const committed = await snapshot();
  await assert.rejects(execute(), error => (error as { cause?: { code?: string } }).cause?.code === "23505");
  assert.deepEqual(await snapshot(), committed, "an existing caller receipt rejects and rolls back the second set of business effects");
  return result;
}

test("row batches and status wrappers compose with caller receipts, including durable events", async () => {
  const source = await table("Composed rows");
  const number = await commands.addColumn({ ...scope, tableId: source.id, name: "Amount", type: "number" });
  const formula = await commands.addColumn({ ...scope, tableId: source.id, name: "Double", type: "formula", config: { formula: "{Amount}*2" } });
  const status = await commands.addColumn({ ...scope, tableId: source.id, name: "Status", type: "select", config: { options: [{ id: "todo", label: "Todo" }, { id: "done", label: "Done" }] } });
  const anchor = await commands.addRow({ ...scope, tableId: source.id, skipAutomation: true });
  await db.insert(automations).values({ organizationId: org, source: { kind: "table", tableId: source.id }, tableId: source.id, name: "Row event", trigger: { type: "row_created" }, actions: [{ type: "update_field", columnId: source.title, value: "Event" }] });
  await db.insert(automations).values({ organizationId: org, source: { kind: "table", tableId: source.id }, tableId: source.id, name: "Amount event", trigger: { type: "field_changed", columnId: number.id }, actions: [{ type: "update_field", columnId: source.title, value: "Changed" }] });
  const runId = await receiptRun(source.id, anchor.id);
  const result = await compose(runId, async tx => {
    const created = await commands.batchAddRows({ ...scope, tableId: source.id, rows: [{ cells: { [number.id]: 1 } }, { cells: { [number.id]: 2 } }] }, tx);
    const single = await commands.addRow({ ...scope, tableId: source.id, cells: { [number.id]: 3 } }, tx);
    await commands.updateCells({ ...scope, rowId: single.id, cells: { [number.id]: 4 } }, tx);
    await commands.updateCell({ ...scope, rowId: single.id, columnId: number.id, value: 5 }, tx);
    await commands.batchUpdateRows({ ...scope, updates: [{ rowId: single.id, cells: { [number.id]: 6 } }, { rowId: created.rowIds[0], cells: { [number.id]: 7 } }] }, tx);
    await commands.setStatus({ ...scope, rowId: single.id, columnId: status.id, statusOptionId: "todo" }, tx);
    await commands.moveCard({ ...scope, rowId: single.id, columnId: status.id, statusOptionId: "done" }, tx);
    await commands.deleteRow({ ...scope, rowId: created.rowIds[0] }, tx);
    await commands.batchDeleteRows({ ...scope, rowIds: [created.rowIds[1]] }, tx);
    return { rowId: single.id };
  });
  const saved = await commands.getRow({ ...scope, rowId: String(result.rowId) });
  assert.equal(saved.cells[number.id], 6); assert.equal(saved.cells[formula.id], 12); assert.equal(saved.cells[status.id], "done");
  assert.equal((await db.select().from(rows).where(eq(rows.tableId, source.id))).length, 2);
  assert((await db.select().from(automationEvents).where(eq(automationEvents.tableId, source.id))).length > 3);
  assert((await snapshot()).outbox.length > 3);
});

test("column batches, relation inverse creation/deletion and reorder use the caller's transaction", async () => {
  const source = await table("Composed columns"), target = await table("Inverse columns");
  const row = await commands.addRow({ ...scope, tableId: source.id });
  const runId = await receiptRun(source.id, row.id);
  const result = await compose(runId, async tx => {
    const added = await commands.batchAddColumns({ ...scope, tableId: source.id, columns: [
      { name: "Amount", type: "number" }, { name: "Temporary calculation", type: "formula", config: { formula: "2+2" } },
    ] }, tx);
    const temporary = await commands.addColumn({ ...scope, tableId: source.id, name: "Peers", type: "relation", config: { relation: { targetTableId: target.id, inverseName: "Back" } } }, tx);
    await commands.batchUpdateColumns({ ...scope, columns: [{ columnId: added.columns[0].id, name: "Renamed amount" }, { columnId: added.columns[1].id, config: { formula: "3+3" } }] }, tx);
    assert.equal((await tx.select().from(rows).where(eq(rows.id, row.id)))[0].cells[added.columns[1].id], 6, "computed cells are visible within the same transaction");
    await commands.updateColumn({ ...scope, columnId: added.columns[0].id, width: 240 }, tx);
    await commands.reorderColumns({ ...scope, tableId: source.id, columnIds: [added.columns[0].id, source.title] }, tx);
    await commands.batchDeleteColumns({ ...scope, columnIds: [added.columns[1].id] }, tx);
    await commands.deleteColumn({ ...scope, columnId: temporary.id }, tx);
    return { columnId: added.columns[0].id };
  });
  const saved = await commands.getTable({ ...scope, tableId: source.id });
  assert.equal(saved.columns.length, 2); assert.equal(saved.columns[0].id, result.columnId);
  assert.equal(saved.columns[0].name, "Renamed amount"); assert.equal(saved.columns[0].width, 240);
  assert.equal((await commands.getTable({ ...scope, tableId: target.id })).columns.length, 1);
});

test("all single and batch relation modes compose inverse/version/event changes with caller receipts", async () => {
  const source = await table("Composed relations"), target = await table("Composed peers");
  const relation = await commands.addColumn({ ...scope, tableId: source.id, name: "Peers", type: "relation", config: { relation: { targetTableId: target.id, inverseName: "Back" } } });
  const inverse = (await commands.getTable({ ...scope, tableId: target.id })).columns.find(column => column.type === "relation")!;
  const a = await commands.addRow({ ...scope, tableId: source.id }), b = await commands.addRow({ ...scope, tableId: source.id });
  const p = await commands.addRow({ ...scope, tableId: target.id }), q = await commands.addRow({ ...scope, tableId: target.id });
  await db.insert(automations).values({ organizationId: org, source: { kind: "table", tableId: source.id }, tableId: source.id, name: "Relation event", trigger: { type: "field_changed", columnId: relation.id }, actions: [{ type: "update_field", columnId: source.title, value: "Related" }] });
  const runId = await receiptRun(source.id, a.id);
  await compose(runId, async tx => {
    await commands.setRelation({ ...scope, rowId: a.id, columnId: relation.id, recordIds: [p.id] }, tx);
    await commands.addRelation({ ...scope, rowId: a.id, columnId: relation.id, recordIds: [q.id] }, tx);
    await commands.removeRelation({ ...scope, rowId: a.id, columnId: relation.id, recordIds: [p.id] }, tx);
    await commands.batchSetRelations({ ...scope, relations: [{ rowId: a.id, columnId: relation.id, recordIds: [p.id] }, { rowId: b.id, columnId: relation.id, recordIds: [q.id] }] }, tx);
    await commands.batchAddRelations({ ...scope, relations: [{ rowId: a.id, columnId: relation.id, recordIds: [q.id] }] }, tx);
    await commands.batchRemoveRelations({ ...scope, relations: [{ rowId: a.id, columnId: relation.id, recordIds: [p.id] }] }, tx);
    return { rowIds: [a.id, b.id], peerId: q.id };
  });
  assert.deepEqual((await commands.getRow({ ...scope, rowId: a.id })).cells[relation.id], [q.id]);
  assert.deepEqual((await commands.getRow({ ...scope, rowId: b.id })).cells[relation.id], [q.id]);
  assert.deepEqual(((await commands.getRow({ ...scope, rowId: q.id })).cells[inverse.id] as string[]).sort(), [a.id, b.id].sort());
  assert.deepEqual((await commands.getRow({ ...scope, rowId: p.id })).cells[inverse.id], []);
});
