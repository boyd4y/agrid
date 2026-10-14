import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { asc, eq, inArray } from "drizzle-orm";
import type { BatchAddRowsInput } from "@tabdo/shared";

if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith("_agent_test"))
  throw new Error("Use a dedicated *_agent_test database");
const { db, client } = await import("../../src/db/index.js");
const { organization, user, member, rows, rowRelations, automationEvents, automationRuns, automationOutbox } = await import("../../src/db/schema.js");
const commands = await import("../../src/commands/index.js");
const org = randomUUID(), foreignOrg = randomUUID(), owner = randomUUID(), scope = { organizationId: org, actorId: owner };
let tableId: string, titleId: string, numberId: string, formulaId: string, relationId: string, targetTableId: string,
  targetId: string, inverseId: string, foreignTableId: string, foreignRowId: string;

before(async () => {
  await db.insert(organization).values([{ id: org, name: "Batch row tests", slug: org }, { id: foreignOrg, name: "Foreign batch tests", slug: foreignOrg }]);
  await db.insert(user).values({ id: owner, name: "Batch fixture owner", email: `${owner}@local.test` });
  await db.insert(member).values({ id: randomUUID(), userId: owner, organizationId: org, role: "owner" });
  targetTableId = (await commands.createTable({ ...scope, name: "Batch targets" })).id;
  targetId = (await commands.addRow({ ...scope, tableId: targetTableId })).id;
  tableId = (await commands.createTable({ ...scope, name: "Batch source" })).id;
  titleId = (await commands.getTable({ ...scope, tableId })).columns[0].id;
  numberId = (await commands.addColumn({ ...scope, tableId, name: "数量", type: "number" })).id;
  formulaId = (await commands.addColumn({ ...scope, tableId, name: "双倍", type: "formula", config: { formula: "{数量} * 2" } })).id;
  const relation = await commands.addColumn({ ...scope, tableId, name: "目标", type: "relation", config: { relation: { targetTableId, inverseName: "来源" } } });
  relationId = relation.id;
  inverseId = (await commands.getTable({ ...scope, tableId: targetTableId })).columns.find((column) => column.config.relation?.relationId === relation.config.relation?.relationId)!.id;
  await commands.createAutomation({ ...scope, tableId, name: "Created row event", trigger: { type: "row_created" }, actions: [{ type: "update_field", columnId: titleId, value: "Automation fixture" }] });
  await commands.createAutomation({ ...scope, tableId, name: "Updated row event", trigger: { type: "field_changed", columnId: numberId }, actions: [{ type: "update_field", columnId: titleId, value: "Update fixture" }] });
  const targetTitle = (await commands.getTable({ ...scope, tableId: targetTableId })).columns[0].id;
  await commands.createAutomation({ ...scope, tableId: targetTableId, name: "Inverse event", trigger: { type: "field_changed", columnId: inverseId }, actions: [{ type: "update_field", columnId: targetTitle, value: "Inverse fixture" }] });
  foreignTableId = (await commands.createTable({ organizationId: foreignOrg, name: "Foreign targets" })).id;
  foreignRowId = (await commands.addRow({ organizationId: foreignOrg, tableId: foreignTableId })).id;
});
after(async () => {
  const tableIds = [tableId, targetTableId, foreignTableId].filter(Boolean);
  if (tableIds.length) await db.delete(automationRuns).where(inArray(automationRuns.tableId, tableIds));
  await db.delete(automationEvents).where(eq(automationEvents.organizationId, org));
  await db.delete(organization).where(inArray(organization.id, [org, foreignOrg]));
  await db.delete(user).where(eq(user.id, owner));
  await client.end();
});
const savedRows = () => db.select().from(rows).where(eq(rows.tableId, tableId)).orderBy(asc(rows.sortOrder));
const ownEvents = () => db.select().from(automationEvents).where(eq(automationEvents.organizationId, org));
const deliveries = () => db.select({ id: automationOutbox.id }).from(automationOutbox).innerJoin(automationEvents, eq(automationOutbox.eventId, automationEvents.id)).where(eq(automationEvents.organizationId, org));

test("one batch creates 100 real records with computed formulas, relations and durable row-created events", async () => {
  const result = await commands.batchAddRows({ ...scope, tableId, rows: Array.from({ length: 100 }, (_, index) => ({ cells: { [titleId]: `Record ${index + 1}`, [numberId]: index + 1, [relationId]: [targetId] } })) });
  assert.equal(result.count, 100);
  assert.equal(new Set(result.rowIds).size, 100);
  assert.deepEqual(Object.keys(result).sort(), ["affectedTableIds", "count", "rowIds"]);
  assert.deepEqual(result.affectedTableIds.sort(), [tableId, targetTableId].sort());
  const stored = await savedRows();
  assert.deepEqual(stored.map((row) => row.id), result.rowIds);
  stored.forEach((row, index) => {
    assert.equal(row.sortOrder, index);
    assert.equal(row.cells[numberId], index + 1);
    assert.equal(row.cells[formulaId], (index + 1) * 2);
    assert.equal(Object.hasOwn(row.cells, relationId), false, "relations remain canonical edges, not duplicate JSON cells");
  });
  assert.equal((await commands.getRow({ ...scope, rowId: targetId })).relations?.[inverseId].total, 100);
  const linked = await commands.queryRelationRecords({ ...scope, columnId: inverseId, rowId: targetId, mode: "related", limit: 100 });
  assert.deepEqual(linked.records.map((row) => row.id).sort(), [...result.rowIds].sort());
  const events = await ownEvents(), created = events.filter((event) => event.tableId === tableId);
  assert.equal(created.length, 100);
  assert.equal(events.length, 200, "inverse relation changes retain their own automation events");
  for (const event of created) {
    const snapshot = event.snapshot as { event: { type: string; cells: Record<string, unknown> } };
    assert.equal(snapshot.event.type, "row_created");
    assert.equal(snapshot.event.cells[formulaId], Number(snapshot.event.cells[numberId]) * 2);
    assert.deepEqual(snapshot.event.cells[relationId], [targetId]);
  }
  assert.equal((await deliveries()).length, 200, "durable deliveries commit with the records");
  assert.equal((await db.select().from(automationRuns).where(inArray(automationRuns.tableId, [tableId, targetTableId]))).length, 200);
});

test("a later invalid row rolls back records, relation peer versions and every automation side effect", async () => {
  const beforeRows = await savedRows(), beforeTarget = await commands.getRow({ ...scope, rowId: targetId }), beforeEvents = await ownEvents();
  const beforeDeliveries = await deliveries();
  const beforeEdges = await db.select().from(rowRelations).where(eq(rowRelations.targetRowId, targetId));
  for (const invalid of [{ [numberId]: "invalid" }, { [relationId]: [foreignRowId] }, { [formulaId]: 9 }, { [randomUUID()]: "foreign field" }]) {
    await assert.rejects(commands.batchAddRows({ ...scope, tableId, rows: [{ cells: { [numberId]: 1, [relationId]: [targetId] } }, { cells: invalid }] }));
    assert.deepEqual(await savedRows(), beforeRows);
    assert.deepEqual(await commands.getRow({ ...scope, rowId: targetId }), beforeTarget, "inverse version and cells roll back together");
    assert.deepEqual(await ownEvents(), beforeEvents);
    assert.deepEqual(await deliveries(), beforeDeliveries);
    assert.deepEqual(await db.select().from(rowRelations).where(eq(rowRelations.targetRowId, targetId)), beforeEdges);
  }
  await assert.rejects(commands.batchAddRows({ ...scope, tableId: foreignTableId, rows: [{}] }), /不属于/);
  assert.equal((await db.select().from(rows).where(eq(rows.tableId, foreignTableId))).length, 1, "foreign tenant is untouched");
});

test("concurrent batches and single-row inserts append in distinct contiguous order and retain skipAutomation", async () => {
  const baselineEvents = (await ownEvents()).length;
  const [first, second, single] = await Promise.all([
    commands.batchAddRows({ ...scope, tableId, rows: [{}, {}, {}], skipAutomation: true }),
    commands.batchAddRows({ ...scope, tableId, rows: [{}, {}, {}], skipAutomation: true }),
    commands.addRow({ ...scope, tableId, skipAutomation: true }),
  ]);
  const added = (await savedRows()).slice(100);
  assert.deepEqual(added.map((row) => row.sortOrder), [100, 101, 102, 103, 104, 105, 106]);
  assert.deepEqual(added.map((row) => row.id).sort(), [...first.rowIds, ...second.rowIds, single.id].sort());
  for (const batch of [first, second]) {
    const positions = batch.rowIds.map((id) => added.findIndex((row) => row.id === id));
    assert.deepEqual(positions, [positions[0], positions[0] + 1, positions[0] + 2], "each batch keeps its input order without interleaving");
  }
  assert.equal((await ownEvents()).length, baselineEvents);
});

test("direct batch callers enforce the 1–100 bound and record shape before writing", async () => {
  const baseline = (await savedRows()).length;
  for (const invalid of [[], Array.from({ length: 101 }, () => ({})), [null], [{ cells: null }], [{ cells: [] }], {}])
    await assert.rejects(commands.batchAddRows({ ...scope, tableId, rows: invalid } as unknown as BatchAddRowsInput));
  assert.equal((await savedRows()).length, baseline);
});

test("batch updates preserve formulas and relation events, while a later version conflict rolls back every write", async () => {
  const [first, second] = await savedRows();
  const newTarget = await commands.addRow({ ...scope, tableId: targetTableId, skipAutomation: true });
  const beforeTarget = await commands.getRow({ ...scope, rowId: targetId });
  const beforeEvents = await ownEvents(), beforeDeliveries = await deliveries();
  const updates = [{ rowId: first.id, cells: { [numberId]: 201, [relationId]: [newTarget.id] }, expectedVersion: first.version },
    { rowId: second.id, cells: { [numberId]: 202 }, expectedVersion: second.version }];
  await assert.rejects(commands.batchUpdateRows({ ...scope, updates: [updates[0], { ...updates[1], expectedVersion: second.version + 1 }] }), /版本冲突/);
  assert.deepEqual((await savedRows()).slice(0, 2), [first, second]);
  assert.deepEqual(await commands.getRow({ ...scope, rowId: targetId }), beforeTarget);
  assert.equal((await commands.getRow({ ...scope, rowId: newTarget.id })).version, newTarget.version);
  assert.deepEqual(await ownEvents(), beforeEvents);
  assert.deepEqual(await deliveries(), beforeDeliveries);
  const result = await commands.batchUpdateRows({ ...scope, updates });
  assert.deepEqual(result.rowIds, [first.id, second.id]);
  assert.equal(result.count, 2);
  assert.deepEqual(result.affectedTableIds.sort(), [tableId, targetTableId].sort());
  const changed = (await savedRows()).slice(0, 2);
  assert.deepEqual(changed.map((row) => row.cells[formulaId]), [402, 404]);
  assert.deepEqual((await commands.getRow({ ...scope, rowId: first.id })).cells[relationId], [newTarget.id]);
  assert.equal((await commands.getRow({ ...scope, rowId: targetId })).relations?.[inverseId].total, 99);
  assert.equal((await ownEvents()).length, beforeEvents.length + 4, "two row changes and two inverse peer events commit together");
  assert.equal((await deliveries()).length, beforeDeliveries.length + 4);
});

test("batch delete enforces all row tenants before removing records and preserves inverse cleanup events", async () => {
  const beforeRows = await savedRows(), [first, second] = beforeRows;
  const beforeEvents = await ownEvents(), beforeDeliveries = await deliveries();
  const linkedTarget = (await commands.getRow({ ...scope, rowId: first.id })).cells[relationId] as string[];
  const peer = await commands.getRow({ ...scope, rowId: linkedTarget[0] });
  for (const denied of [foreignRowId, randomUUID()]) {
    await assert.rejects(commands.batchDeleteRows({ ...scope, rowIds: [first.id, denied] }), /不存在|不属于/);
    assert.deepEqual(await savedRows(), beforeRows);
    assert.deepEqual(await commands.getRow({ ...scope, rowId: peer.id }), peer);
    assert.deepEqual(await ownEvents(), beforeEvents);
    assert.deepEqual(await deliveries(), beforeDeliveries);
  }
  const result = await commands.batchDeleteRows({ ...scope, rowIds: [first.id, second.id] });
  assert.deepEqual(result.rowIds, [first.id, second.id]);
  assert.equal(result.count, 2);
  assert.deepEqual(result.affectedTableIds.sort(), [tableId, targetTableId].sort());
  assert.equal((await savedRows()).length, beforeRows.length - 2);
  assert.equal((await commands.getRow({ ...scope, rowId: peer.id })).relations?.[inverseId].total, 0);
  assert.equal((await commands.getRow({ ...scope, rowId: targetId })).relations?.[inverseId].total, 98);
  assert.equal((await ownEvents()).length, beforeEvents.length + 2);
  assert.equal((await deliveries()).length, beforeDeliveries.length + 2);
  assert.equal((await db.select().from(rows).where(eq(rows.tableId, foreignTableId))).length, 1);
});

test("batch update/delete reject malformed, oversized and duplicate requests before mutation", async () => {
  const [row] = await savedRows(), baseline = await savedRows();
  for (const updates of [[], Array.from({ length: 101 }, () => ({ rowId: row.id, cells: {} })), [null], [{ rowId: row.id, cells: [] }], [{ rowId: row.id, cells: {}, expectedVersion: 0 }], [{ rowId: row.id, cells: {} }, { rowId: row.id, cells: {} }]])
    await assert.rejects(commands.batchUpdateRows({ ...scope, updates } as unknown as Parameters<typeof commands.batchUpdateRows>[0]));
  for (const rowIds of [[], Array.from({ length: 101 }, () => row.id), [null], [row.id, row.id]])
    await assert.rejects(commands.batchDeleteRows({ ...scope, rowIds } as unknown as Parameters<typeof commands.batchDeleteRows>[0]));
  await assert.rejects(commands.batchUpdateRows({ ...scope, updates: [{ rowId: row.id, cells: { [numberId]: 500 } }, { rowId: foreignRowId, cells: {} }] }), /不属于/);
  assert.deepEqual(await savedRows(), baseline);
});

test("self-relation batch updates validate original versions while accepting their own inverse version changes", async () => {
  const selfTable = await commands.createTable({ ...scope, name: "Batch self relations" });
  const number = await commands.addColumn({ ...scope, tableId: selfTable.id, name: "数量", type: "number" });
  const formula = await commands.addColumn({ ...scope, tableId: selfTable.id, name: "双倍", type: "formula", config: { formula: "{数量} * 2" } });
  const relation = await commands.addColumn({ ...scope, tableId: selfTable.id, name: "关联", type: "relation", config: { relation: { targetTableId: selfTable.id, inverseName: "反向" } } });
  const inverse = (await commands.getTable({ ...scope, tableId: selfTable.id })).columns.find((column) => column.id !== relation.id && column.config.relation?.relationId === relation.config.relation?.relationId)!;
  const first = await commands.addRow({ ...scope, tableId: selfTable.id, cells: { [number.id]: 1 } });
  const second = await commands.addRow({ ...scope, tableId: selfTable.id, cells: { [number.id]: 2 } });
  const updates = [{ rowId: first.id, cells: { [relation.id]: [second.id], [number.id]: 10 }, expectedVersion: first.version },
    { rowId: second.id, cells: { [relation.id]: [first.id], [number.id]: 20 }, expectedVersion: second.version }];
  await assert.rejects(commands.batchUpdateRows({ ...scope, updates: [updates[0], { ...updates[1], expectedVersion: second.version! + 1 }] }), /版本冲突/);
  assert.deepEqual((await commands.getRow({ ...scope, rowId: first.id })).cells[relation.id], []);
  assert.equal((await commands.getRow({ ...scope, rowId: second.id })).version, second.version);
  const result = await commands.batchUpdateRows({ ...scope, updates });
  assert.equal(result.count, 2);
  const a = await commands.getRow({ ...scope, rowId: first.id }), b = await commands.getRow({ ...scope, rowId: second.id });
  assert.deepEqual(a.cells[relation.id], [second.id]);
  assert.deepEqual(b.cells[relation.id], [first.id]);
  assert.deepEqual(a.cells[inverse.id], [second.id]);
  assert.deepEqual(b.cells[inverse.id], [first.id]);
  assert.equal(a.cells[formula.id], 20);
  assert.equal(b.cells[formula.id], 40);
  assert.equal(a.version, first.version! + 2);
  assert.equal(b.version, second.version! + 2, "inverse write plus direct update do not trigger a false stale-version rejection");
});
