import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCell } from "../src/filters.js";
import type { CellValue } from "../src/types.js";

for (const type of ["multi_select", "relation"]) {
  test(`${type} requires string elements regardless of options`, () => {
    for (const options of [undefined, [], [{ id: "known" }]]) {
      for (const value of [[{}], [1], ["known", {}], [["known"]], [null]]) {
        assert.equal(validateCell(type, value as CellValue, options), "必须是字符串数组");
      }
      for (const value of [null, "", [], ["known"]]) {
        assert.equal(validateCell(type, value, options), null);
      }
    }
    assert.equal(validateCell(type, ["other"], []), null);
    assert.equal(validateCell(type, ["other"], [{ id: "known" }]), "包含无效选项");
  });
}
