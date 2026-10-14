import assert from "node:assert/strict";
import { test } from "node:test";
import { assertObjectKey } from "../src/index.js";

test("portable object keys do not impose a product UUID namespace", () => {
  for (const key of ["reports/weekly.txt", "exports/周报.csv", "single-object", "customer-42/avatar.png"]) assertObjectKey(key);
  for (const key of ["../secret", "/etc/passwd", "a/../secret", "a/./secret", "a//b", "C:/secret", "a\\b", "a\0b", ""])
    assert.throws(() => assertObjectKey(key), /Invalid object storage key/);
});
