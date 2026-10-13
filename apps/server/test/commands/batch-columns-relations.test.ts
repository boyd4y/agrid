import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
if (!process.env.DATABASE_URL?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
const { db, client } = await import("../../src/db/index.js");
const { organization, automationEvents } = await import("../../src/db/schema.js");
const cmds = await import("../../src/commands/index.js");
const org = randomUUID(), foreignOrg = randomUUID(), scope = { organizationId: org };
before(async () => { await db.insert(organization).values([{ id: org, name: "Batch schema", slug: org }, { id: foreignOrg, name: "Foreign", slug: foreignOrg }]); });
after(async () => { for (const id of [org, foreignOrg]) await db.delete(organization).where(eq(organization.id, id)); await client.end(); });
const table = async (name: string) => (await cmds.createTable({ ...scope, name })).id;
const get = (tableId: string) => cmds.getTable({ ...scope, tableId });

test("batch column creation includes ordered formulas and rolls back inverse columns and computed cells", async () => {
  const a = await table("Create"), b = await table("Target");
  const row = await cmds.addRow({ ...scope, tableId: a });
  const added = await cmds.batchAddColumns({ ...scope, tableId: a, columns: [{ name: "Amount", type: "number" }, { name: "Double", type: "formula", config: { formula: "2+2" } }] });
  assert.equal(added.count, 2); assert.deepEqual(added.columns.map((c) => c.sortOrder), [1, 2]);
  assert.equal((await cmds.getRow({ ...scope, rowId: row.id })).cells[added.columns[1].id], 4);
  const before = await cmds.getRow({ ...scope, rowId: row.id });
  await assert.rejects(cmds.batchAddColumns({ ...scope, tableId: a, columns: [
    { name: "Peer", type: "relation", config: { relation: { targetTableId: b, inverseName: "Back" } } },
    { name: "Broken", type: "formula", config: { formula: "(" } },
  ] }));
  assert.equal((await get(a)).columns.length, 3); assert.equal((await get(b)).columns.length, 1);
  const afterRow = await cmds.getRow({ ...scope, rowId: row.id }); assert.deepEqual(afterRow.cells, before.cells); assert.equal(afterRow.version, before.version);
  await assert.rejects(cmds.batchAddColumns({ ...scope, tableId: a, columns: Array.from({ length: 101 }, () => ({ name: "Too many", type: "text" as const })) }));
});

test("failed batch column update rolls back type conversion, incompatible-cell cleanup and row versions", async () => {
  const id = await table("Update");
  const created = await cmds.batchAddColumns({ ...scope, tableId: id, columns: [{ name: "Value", type: "text" }, { name: "Calc", type: "formula", config: { formula: "1+1" } }] });
  const [text, formula] = created.columns;
  const row = await cmds.addRow({ ...scope, tableId: id, cells: { [text.id]: "not a number" } });
  const before = await cmds.getRow({ ...scope, rowId: row.id });
  await assert.rejects(cmds.batchUpdateColumns({ ...scope, columns: [{ columnId: text.id, type: "number" }, { columnId: formula.id, config: { formula: "(" } }] }));
  assert.equal((await get(id)).columns.find((c) => c.id === text.id)!.type, "text");
  const rolledBack = await cmds.getRow({ ...scope, rowId: row.id }); assert.deepEqual(rolledBack.cells, before.cells); assert.equal(rolledBack.version, before.version);
  const changed = await cmds.batchUpdateColumns({ ...scope, columns: [{ columnId: text.id, type: "number" }, { columnId: formula.id, config: { formula: "3+3" } }] });
  assert.equal(changed.count, 2); const afterRow = await cmds.getRow({ ...scope, rowId: row.id });
  assert.equal(afterRow.cells[text.id], null); assert.equal(afterRow.cells[formula.id], 6); assert(afterRow.version > before.version);
  await assert.rejects(cmds.batchUpdateColumns({ ...scope, columns: [{ columnId: text.id, name: "A" }, { columnId: text.id, name: "B" }] }));
});

test("batch column deletion preserves rollup and tenant checks and removes inverse pairs atomically", async () => {
  const target = await table("Delete target"), source = await table("Delete source");
  const added = await cmds.batchAddColumns({ ...scope, tableId: target, columns: [{ name: "Unused", type: "text" }, { name: "Amount", type: "number" }] });
  const relation = await cmds.addColumn({ ...scope, tableId: source, name: "Target", type: "relation", config: { relation: { targetTableId: target, inverseName: "Sources" } } });
  const rollup = await cmds.addColumn({ ...scope, tableId: source, name: "Sum", type: "rollup", config: { rollup: { relationColumnId: relation.id, targetColumnId: added.columns[1].id, operation: "sum" } } });
  await assert.rejects(cmds.batchDeleteColumns({ ...scope, columnIds: added.columns.map((c) => c.id) }), /汇总/);
  assert((await get(target)).columns.some((c) => c.id === added.columns[0].id));
  const foreign = await cmds.createTable({ organizationId: foreignOrg, name: "Foreign" });
  const foreignColumn = (await cmds.getTable({ organizationId: foreignOrg, tableId: foreign.id })).columns[0];
  await assert.rejects(cmds.batchDeleteColumns({ ...scope, columnIds: [added.columns[0].id, foreignColumn.id] }));
  assert((await get(target)).columns.some((c) => c.id === added.columns[0].id));
  const inverse = (await get(target)).columns.find((c) => c.type === "relation")!;
  const removed = await cmds.batchDeleteColumns({ ...scope, columnIds: [relation.id, inverse.id, rollup.id] });
  assert.equal(removed.count, 3); assert(!(await get(source)).columns.some((c) => c.type === "relation")); assert(!(await get(target)).columns.some((c) => c.type === "relation"));
});

test("batch relation set/add/remove preserves inverses, CAS, limits and automation rollback", async () => {
  const source = await table("Relation source"), target = await table("Relation target");
  const added = await cmds.batchAddColumns({ ...scope, tableId: source, columns: [
    { name: "Peers", type: "relation", config: { relation: { targetTableId: target, inverseName: "Sources" } } },
    { name: "One", type: "relation", config: { relation: { targetTableId: target, limit: "one" } } },
  ] });
  const [many, one] = added.columns;
  const inverse = (await get(target)).columns.find((c) => c.type === "relation")!;
  const r1 = await cmds.addRow({ ...scope, tableId: source }), r2 = await cmds.addRow({ ...scope, tableId: source });
  const p1 = await cmds.addRow({ ...scope, tableId: target }), p2 = await cmds.addRow({ ...scope, tableId: target });
  const set = await cmds.batchSetRelations({ ...scope, relations: [{ rowId: r1.id, columnId: many.id, recordIds: [p1.id], expectedVersion: r1.version }, { rowId: r1.id, columnId: one.id, recordIds: [p2.id], expectedVersion: r1.version }] });
  assert.equal(set.count, 2); assert.equal(set.rows.length, 1); assert.equal(set.rows[0].version, r1.version + 1);
  assert.deepEqual((await cmds.getRow({ ...scope, rowId: p1.id })).cells[inverse.id], [r1.id]);
  await cmds.batchAddRelations({ ...scope, relations: [{ rowId: r1.id, columnId: many.id, recordIds: [p2.id] }, { rowId: r2.id, columnId: many.id, recordIds: [p1.id] }] });
  await cmds.batchRemoveRelations({ ...scope, relations: [{ rowId: r1.id, columnId: many.id, recordIds: [p1.id] }, { rowId: r2.id, columnId: many.id, recordIds: [p1.id] }] });
  const before = await cmds.getRow({ ...scope, rowId: r1.id }), peerBefore = await cmds.getRow({ ...scope, rowId: p1.id });
  const eventsBefore = (await db.select().from(automationEvents).where(eq(automationEvents.organizationId, org))).length;
  await assert.rejects(cmds.batchSetRelations({ ...scope, relations: [{ rowId: r1.id, columnId: many.id, recordIds: [p1.id] }, { rowId: r2.id, columnId: one.id, recordIds: [p1.id, p2.id] }] }), /最多/);
  const afterRow = await cmds.getRow({ ...scope, rowId: r1.id }), peerAfter = await cmds.getRow({ ...scope, rowId: p1.id });
  assert.deepEqual(afterRow.cells, before.cells); assert.equal(afterRow.version, before.version); assert.deepEqual(peerAfter.cells, peerBefore.cells); assert.equal(peerAfter.version, peerBefore.version);
  assert.equal((await db.select().from(automationEvents).where(eq(automationEvents.organizationId, org))).length, eventsBefore);
  const foreignTable = (await cmds.createTable({ organizationId: foreignOrg, name: "Foreign peers" })).id;
  const foreignRow = await cmds.addRow({ organizationId: foreignOrg, tableId: foreignTable });
  await assert.rejects(cmds.batchSetRelations({ ...scope, relations: [
    { rowId: r1.id, columnId: many.id, recordIds: [p1.id] },
    { rowId: r2.id, columnId: many.id, recordIds: [foreignRow.id] },
  ] }), /目标表格/);
  assert.deepEqual((await cmds.getRow({ ...scope, rowId: r1.id })).cells, before.cells);
  await assert.rejects(cmds.batchSetRelations({ ...scope, relations: [{ rowId: r1.id, columnId: many.id, recordIds: [], expectedVersion: 0 }] }), /版本冲突/);
  await assert.rejects(cmds.batchSetRelations({ ...scope, relations: [{ rowId: r1.id, columnId: many.id, recordIds: [] }, { rowId: r1.id, columnId: many.id, recordIds: [] }] }));
});

test("self-relation batch checks original CAS without rejecting its own inverse version changes", async () => {
  const id = await table("Self relations");
  const relation = await cmds.addColumn({ ...scope, tableId: id, name: "Peers", type: "relation", config: { relation: { targetTableId: id, inverseName: "Back" } } });
  const a = await cmds.addRow({ ...scope, tableId: id }), b = await cmds.addRow({ ...scope, tableId: id });
  const result = await cmds.batchSetRelations({ ...scope, relations: [
    { rowId: a.id, columnId: relation.id, recordIds: [b.id], expectedVersion: a.version },
    { rowId: b.id, columnId: relation.id, recordIds: [a.id], expectedVersion: b.version },
  ] });
  for (const row of result.rows) {
    const canonical = await cmds.getRow({ ...scope, rowId: row.id });
    assert.equal(row.version, canonical.version); assert.deepEqual(row.cells, canonical.cells);
  }
  assert.deepEqual((await cmds.getRow({ ...scope, rowId: a.id })).cells[relation.id], [b.id]);
  assert.deepEqual((await cmds.getRow({ ...scope, rowId: b.id })).cells[relation.id], [a.id]);
  await assert.rejects(cmds.batchSetRelations({ ...scope, relations: [
    { rowId: a.id, columnId: relation.id, recordIds: [], expectedVersion: a.version },
  ] }), /版本冲突/);
});
