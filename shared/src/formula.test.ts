import {
  evaluateFormula,
  extractFormulaDeps,
  recomputeRowFormulas,
  sortFormulaColumns,
  validateFormula,
} from "./formula.js";
import type { ColumnDef } from "./types.js";

function col(
  id: string,
  name: string,
  type: string,
  config: ColumnDef["config"] = {},
  sortOrder = 0
): ColumnDef {
  return {
    id,
    tableId: "t1",
    name,
    type,
    config,
    width: 120,
    sortOrder,
    createdAt: new Date(),
  };
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const hours = col("c_hours", "预估工时", "number");
const done = col("c_done", "已完成", "checkbox");
const title = col("c_title", "标题", "text");
const fx = col("c_fx", "工时×8", "formula", {
  formula: "{预估工时} * 8",
  formulaResultType: "number",
});
const fxIf = col("c_if", "状态文案", "formula", {
  formula: 'IF({已完成}, "完成", "进行中")',
  formulaResultType: "text",
});

const columns = [hours, done, title, fx, fxIf];

// deps
assert(
  extractFormulaDeps("{预估工时} * 8 + {已完成}").join(",") === "预估工时,已完成",
  "deps"
);

// arithmetic
{
  const r = evaluateFormula("{预估工时} * 8", columns, { c_hours: 3 });
  assert(r.error == null && r.value === 24, `arith got ${r.value} ${r.error}`);
}

// IF + string
{
  const r = evaluateFormula('IF({已完成}, "完成", "进行中")', columns, {
    c_done: false,
  });
  assert(r.value === "进行中", `if false got ${r.value}`);
  const r2 = evaluateFormula('IF({已完成}, "完成", "进行中")', columns, {
    c_done: true,
  });
  assert(r2.value === "完成", `if true got ${r2.value}`);
}

// CONCAT / LEN
{
  const r = evaluateFormula('CONCAT({标题}, "-", TEXT({预估工时}))', columns, {
    c_title: "A",
    c_hours: 2,
  });
  assert(r.value === "A-2", `concat got ${r.value}`);
  const len = evaluateFormula("LEN({标题})", columns, { c_title: "你好" });
  assert(len.value === 2, `len got ${len.value}`);
}

// validate unknown
assert(validateFormula("{不存在}", columns) !== null, "unknown ref");

// recompute row
{
  const cells = recomputeRowFormulas(columns, {
    c_hours: 5,
    c_done: true,
    c_title: "X",
  });
  assert(cells.c_fx === 40, `recompute fx ${cells.c_fx}`);
  assert(cells.c_if === "完成", `recompute if ${cells.c_if}`);
}

// formula depends on formula (topo)
{
  const mid = col("c_mid", "中段", "formula", {
    formula: "{预估工时} + 1",
    formulaResultType: "number",
  });
  const top = col("c_top", "顶层", "formula", {
    formula: "{中段} * 2",
    formulaResultType: "number",
  });
  const cols2 = [hours, mid, top];
  const ordered = sortFormulaColumns(cols2).map((c) => c.id);
  assert(ordered.indexOf("c_mid") < ordered.indexOf("c_top"), "topo order");
  const cells = recomputeRowFormulas(cols2, { c_hours: 4 });
  assert(cells.c_mid === 5 && cells.c_top === 10, `chain ${cells.c_mid} ${cells.c_top}`);
}

console.log("formula.test.ts: all passed");
