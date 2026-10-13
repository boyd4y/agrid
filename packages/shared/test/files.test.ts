import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { ADD_COLUMN_SCHEMA, UPDATE_COLUMN_SCHEMA } from "../src/batch-columns.js";
import { applyFilters, opsForType, validateCell } from "../src/filters.js";
import type { ColumnDef, RowData } from "../src/types.js";

test("file columns carry single/multiple configuration through command schemas", () => {
  const tableId = randomUUID(), columnId = randomUUID();
  for (const multiple of [false, true]) {
    assert.equal(ADD_COLUMN_SCHEMA.parse({ tableId, name: "附件", type: "file", config: { file: { multiple } } }).config?.file?.multiple, multiple);
    assert.equal(UPDATE_COLUMN_SCHEMA.parse({ columnId, config: { file: { multiple } } }).config?.file?.multiple, multiple);
  }
  assert(!ADD_COLUMN_SCHEMA.safeParse({ tableId, name: "附件", type: "file", config: { file: { multiple: "false" } } }).success);
});

test("file cell wire values allow clearing and reject URLs, duplicate or malformed IDs", () => {
  const id = randomUUID();
  for (const value of [null, [], [id]]) assert.equal(validateCell("file", value), null);
  for (const value of ["https://example.com/file", ["../../private"], [id, id], true, ""]) assert(validateCell("file", value));
});

test("file emptiness matches absent, null and empty array values in shared filters", () => {
  const column: ColumnDef = { id: randomUUID(), tableId: randomUUID(), name: "附件", type: "file", config: {}, width: 160, sortOrder: 0, createdAt: new Date() };
  const rows: RowData[] = [undefined, null, [], [randomUUID()]].map((value, index) => ({ id: String(index), tableId: column.tableId, cells: value === undefined ? {} : { [column.id]: value }, sortOrder: index, createdAt: new Date(), updatedAt: new Date() }));
  const filter = { id: "files", columnId: column.id };
  assert.deepEqual(opsForType("file"), ["is_empty", "is_not_empty"]);
  assert.deepEqual(applyFilters(rows, [column], { filters: [{ ...filter, op: "is_empty" }] }).map(row => row.id), ["0", "1", "2"]);
  assert.deepEqual(applyFilters(rows, [column], { filters: [{ ...filter, op: "is_not_empty" }] }).map(row => row.id), ["3"]);
});
