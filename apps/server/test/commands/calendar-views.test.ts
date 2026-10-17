import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "../runtime.js";
import { eq } from "drizzle-orm";
if (!process.env.DATABASE_URL?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
const { db, client } = await import("../../src/db/index.js");
const { organization, rows, columns, tableViews } = await import("../../src/db/schema.js");
const commands = await import("../../src/commands/index.js");
const org = randomUUID(), other = randomUUID(), scope = { organizationId: org };
let tableId: string, titleId: string, startId: string, endId: string, personId: string, viewId: string;
const query = (extra = {}) => commands.queryCalendarView({ ...scope, viewId, rangeStart: "2030-03-01", rangeEnd: "2030-04-01", ...extra });
before(async () => {
  await db.insert(organization).values([{ id: org, name: "Date records", slug: org }, { id: other, name: "Other", slug: other }]);
  tableId = (await commands.createTable({ ...scope, name: "Calendar records" })).id;
  titleId = (await commands.getTable({ ...scope, tableId })).columns[0].id;
  startId = (await commands.addColumn({ ...scope, tableId, name: "Same date", type: "date" })).id;
  endId = (await commands.addColumn({ ...scope, tableId, name: "End date", type: "date" })).id;
  personId = (await commands.addColumn({ ...scope, tableId, name: "Owner", type: "person" })).id;
  viewId = (await commands.createCalendarView({ ...scope, tableId, config: { startColumnId: startId, endColumnId: endId, titleColumnId: titleId, personColumnId: personId } })).id;
});
after(async () => { await db.delete(organization).where(eq(organization.id, org)); await db.delete(organization).where(eq(organization.id, other)); await client.end(); });
test("date-only overlaps span the window, stable pagination exceeds 500, invalid dates diagnose without casts or raw cells", async () => {
  const records = [
    { id: randomUUID(), title: "Across window", start: "2030-02-01", end: "2030-05-01" },
    { id: randomUUID(), title: "Last inclusive day", start: "2030-02-28", end: "2030-03-01" },
    { id: randomUUID(), title: "End at boundary", start: "2030-02-01", end: "2030-02-28" },
    { id: randomUUID(), title: "Outside", start: "2030-04-01" },
    { id: randomUUID(), title: "Invalid leap day", start: "2030-02-29" },
    { id: randomUUID(), title: "Bad format", start: "2030-03-01T00:00:00Z" },
    { id: randomUUID(), title: "Missing start" },
    { id: randomUUID(), title: "Bad end", start: "2030-03-01", end: "2030-04-31" },
    { id: randomUUID(), title: "Reverse", start: "2030-03-02", end: "2030-03-01" },
  ];
  await db.insert(rows).values(records.map(record => ({ id: record.id, tableId, cells: { [titleId]: record.title, [startId]: record.start ?? null, [endId]: record.end ?? null } })));
  const bulk = Array.from({ length: 507 }, (_, index) => ({ id: randomUUID(), tableId, cells: { [titleId]: `Record ${index}`, [startId]: "2030-03-15", [endId]: null } }));
  await db.insert(rows).values(bulk);
  const ids: string[] = []; let cursor: string | null = null;
  do {
    const page = await query({ limit: 37, cursor });
    assert.deepEqual(page.diagnostics, { mapping: [], emptyStart: 1, invalidStart: 2, invalidEnd: 1, reversed: 1 });
    assert(page.items.length <= 37); ids.push(...page.items.map(item => item.rowId)); cursor = page.nextCursor;
    assert.equal(page.hasMore, cursor !== null);
    if (!ids.length) throw new Error("No rows returned");
  } while (cursor);
  assert.equal(ids.length, 509); assert.equal(new Set(ids).size, ids.length);
  assert(ids.includes(records[0].id)); assert(ids.includes(records[1].id)); assert(!ids.includes(records[2].id));
  const first = await query({ limit: 1 }); assert.equal(first.items[0].start, "2030-02-01"); assert.equal(first.items[0].end, "2030-05-02");
  assert(!("cells" in first.items[0]));
  await assert.rejects(query({ cursor: first.nextCursor, rangeStart: "2030-03-02" }), /游标/);
  await assert.rejects(query({ cursor: "bogus" }), /游标/);
  await assert.rejects(query({ rangeStart: "2030-02-29" }));
  await commands.updateCalendarView({ ...scope, viewId, config: { startColumnId: startId, endColumnId: endId, titleColumnId: titleId, endMode: "exclusive" } });
  const exclusive = await query(); assert(!exclusive.items.some(item => item.rowId === records[1].id)); assert.equal(exclusive.items[0].end, "2030-05-01");
  await assert.rejects(query({ cursor: first.nextCursor }), /游标/);
});
test("mapping validation, lifecycle and row CAS retain original records and diagnose deleted/hidden/retyped fields", async () => {
  const foreignTable = await commands.createTable({ ...scope, name: "Other source" });
  const foreignDate = await commands.addColumn({ ...scope, tableId: foreignTable.id, name: "Same date", type: "date" });
  await assert.rejects(commands.updateCalendarView({ ...scope, viewId, config: { startColumnId: foreignDate.id } }), /映射/);
  const badConfig = { startColumnId: titleId };
  await assert.rejects(commands.createCalendarView({ ...scope, tableId, config: badConfig }), /映射/);
  await assert.rejects(commands.createCalendarView({ ...scope, tableId, config: { startColumnId: startId, endColumnId: startId } }));
  await assert.rejects(query({ organizationId: other }));
  const record = await commands.addRow({ ...scope, tableId, cells: { [startId]: "2030-03-10", [endId]: "2030-03-12" } });
  const moved = await commands.updateCells({ ...scope, rowId: record.id, expectedVersion: record.version, cells: { [startId]: "2030-03-11", [endId]: "2030-03-13" } });
  assert.equal(moved.version, record.version + 1);
  await assert.rejects(commands.updateCells({ ...scope, rowId: record.id, expectedVersion: record.version, cells: { [startId]: "2030-03-12", [endId]: "2030-03-14" } }), /版本冲突/);
  assert.equal((await commands.getRow({ ...scope, rowId: record.id })).cells[endId], "2030-03-13");
  const original = (await commands.getView({ ...scope, viewId })).config;
  await db.update(columns).set({ config: { hidden: true } }).where(eq(columns.id, titleId));
  const hidden = await query(); assert.deepEqual(hidden.items, []); assert.deepEqual(hidden.diagnostics.mapping, [{ field: "titleColumnId", code: "hidden" }]);
  await db.update(columns).set({ config: {} }).where(eq(columns.id, titleId));
  await db.update(columns).set({ type: "formula", config: { formula: "1" } }).where(eq(columns.id, startId));
  assert.deepEqual((await query()).diagnostics.mapping, [{ field: "startColumnId", code: "type" }]);
  await db.update(columns).set({ type: "date", config: {} }).where(eq(columns.id, startId));
  await commands.deleteColumn({ ...scope, columnId: endId });
  assert.deepEqual((await query()).diagnostics.mapping, [{ field: "endColumnId", code: "missing" }]);
  assert.deepEqual((await commands.getView({ ...scope, viewId })).config, original, "keep invalid mappings for repair");
  await commands.updateCalendarView({ ...scope, viewId, config: { startColumnId: startId, titleColumnId: titleId } });
  assert.equal((await query()).diagnostics.mapping.length, 0);
  const grid = await commands.createGridView({ ...scope, tableId });
  await commands.renameView({ ...scope, viewId, name: "Dates" }); await commands.setDefaultView({ ...scope, viewId });
  assert.equal((await commands.listViews({ ...scope, tableId })).find(view => view.id === viewId)?.isDefault, true);
  await commands.deleteView({ ...scope, viewId });
  assert.equal((await commands.getView({ ...scope, viewId: grid.id })).isDefault, true);
  await db.insert(tableViews).values({ tableId, type: "future-view", name: "Future", config: { future: true } });
  assert((await commands.listViews({ ...scope, tableId })).some(view => view.type === "future-view"));
});
