import assert from "node:assert/strict";
import { test } from "node:test";
import { triggerMatches, changedColumns, automationConditionsMatch, type AutomationEvent } from "../src/automation.js";
import type { CellValue, ColumnDef, RowData } from "../src/types.js";

test("enter_status triggers only when a single or multiple selection gains the target option", () => {
  const trigger = { type: "enter_status" as const, columnId: "status", optionId: "done" };
  const changed = (before: CellValue, after: CellValue): AutomationEvent => ({
    type: "cells_changed", tableId: "table", rowId: "row", before: { status: before }, after: { status: after },
    changedColumnIds: changedColumns({ status: before }, { status: after }),
  });
  for (const [before, after, expected] of [
    [null, "done", true], ["todo", "done", true], ["done", "done", false], ["done", "todo", false],
    [[], ["done"], true], [["todo"], ["todo", "done"], true],
    [["done"], ["done", "todo"], false], [["done", "todo"], ["todo", "done"], false],
    [["done"], [], false],
  ] as [CellValue, CellValue, boolean][]) assert.equal(triggerMatches(trigger, changed(before, after)), expected, JSON.stringify([before, after]));
  assert.equal(triggerMatches(trigger, { type: "row_created", tableId: "table", rowId: "row", cells: { status: "done" } }), false);
});

test("automation matching never drops incomplete or deleted-column conditions, including OR groups", () => {
  const column: ColumnDef = { id: "title", tableId: "table", name: "Title", type: "text", config: {}, width: 120, sortOrder: 0, createdAt: new Date() };
  const row: RowData = { id: "row", tableId: "table", cells: { title: "match" }, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() };
  const valid = { id: "valid", columnId: "title", op: "eq" as const, value: "match" };
  for (const logic of ["and", "or"] as const) {
    assert.equal(automationConditionsMatch(row, [column], [valid], logic), true);
    assert.equal(automationConditionsMatch(row, [column], [valid, { ...valid, id: "incomplete", value: "" }], logic), false);
    assert.equal(automationConditionsMatch(row, [column], [valid, { ...valid, id: "deleted", columnId: "deleted" }], logic), false);
  }
});
