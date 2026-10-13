import assert from "node:assert/strict";
import { test } from "node:test";
import { applyFilters } from "../src/filters.js";
import { recomputeRowFormulas } from "../src/formula.js";
import type { ColumnDef, RowData } from "../src/types.js";

const column = (
  id: string,
  type: string,
  config: ColumnDef["config"] = {},
): ColumnDef => ({
  id,
  name: id,
  tableId: "filter-table",
  type,
  config,
  width: 120,
  sortOrder: 0,
  createdAt: new Date(),
});
const columns = [
  column("date", "date"),
  column("checked", "checkbox"),
  column("dateFormula", "formula", {
    formula: "{date}",
    formulaResultType: "date",
  }),
  column("autoDate", "formula", {
    formula: "{date}",
    formulaResultType: "auto",
  }),
  column("autoCheckbox", "formula", {
    formula: "{checked}",
    formulaResultType: "auto",
  }),
  column("checkboxFormula", "formula", {
    formula: "{checked}",
    formulaResultType: "checkbox",
  }),
];
const rows: RowData[] = [
  ["before", "2026-01-01", false],
  ["afterUnchecked", "2026-05-01", false],
  ["afterChecked", "2026-09-01", true],
].map(([id, date, checked], index) => ({
  id: String(id),
  tableId: "filter-table",
  cells: recomputeRowFormulas(columns, {
    date: String(date),
    checked: Boolean(checked),
  }),
  sortOrder: index,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

test("automation filters compare declared and auto formula dates as dates, and checkbox results as booleans", () => {
  for (const columnId of ["dateFormula", "autoDate"]) {
    assert.deepEqual(
      applyFilters(rows, columns, {
        filters: [
          { id: "after", columnId, op: "gte", value: "2026-05-01" },
          {
            id: "unchecked",
            columnId: "checkboxFormula",
            op: "eq",
            value: false,
          },
        ],
      }).map((row) => row.id),
      ["afterUnchecked"],
    );
  }
  const failed: RowData = {
    ...rows[0],
    id: "failed",
    cells: {
      dateFormula: "#ERR:date calculation failed",
      autoDate: "#ERR:date calculation failed",
    },
  };
  assert.deepEqual(
    applyFilters([...rows, failed], columns, {
      filters: [
        {
          id: "before",
          columnId: "dateFormula",
          op: "lte",
          value: "2026-02-01",
        },
      ],
    }).map((row) => row.id),
    ["before"],
  );

  const empty: RowData = {
    ...rows[0],
    id: "empty",
    cells: { checked: null, checkboxFormula: null, autoCheckbox: null },
  };
  for (const columnId of ["checked", "checkboxFormula", "autoCheckbox"]) {
    assert.deepEqual(
      applyFilters([...rows, empty], columns, {
        filters: [{ id: "empty", columnId, op: "is_empty" }],
      }).map((row) => row.id),
      ["before", "afterUnchecked", "empty"],
    );
    assert.deepEqual(
      applyFilters([...rows, empty], columns, {
        filters: [{ id: "nonempty", columnId, op: "is_not_empty" }],
      }).map((row) => row.id),
      ["afterChecked"],
    );
  }
  const textFalse: RowData = {
    ...rows[0],
    id: "textFalse",
    cells: { autoCheckbox: "false" },
  };
  assert.deepEqual(
    applyFilters([...rows, empty, textFalse], columns, {
      filters: [{ id: "empty", columnId: "autoCheckbox", op: "is_empty" }],
    }).map((row) => row.id),
    ["before", "afterUnchecked", "empty"],
  );
  assert.deepEqual(
    applyFilters([...rows, empty, textFalse], columns, {
      filters: [
        { id: "nonempty", columnId: "autoCheckbox", op: "is_not_empty" },
      ],
    }).map((row) => row.id),
    ["afterChecked", "textFalse"],
  );
});
