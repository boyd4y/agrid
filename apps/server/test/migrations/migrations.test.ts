import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { orphanPolicy } from "../../src/db/migrate.js";

test("all journal timestamps strictly increase without changing tag order", () => {
  const { entries } = JSON.parse(fs.readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  assert.equal(entries[25].tag, "0025_scheduled_sessions");
  entries.forEach((entry: { idx: number; tag: string; when: number }, i: number) => {
    assert.equal(entry.idx, i);
    assert.ok(entry.tag.startsWith(String(i).padStart(4, "0") + "_"));
    if (i) assert.ok(entry.when > entries[i - 1].when);
  });
});

test("orphan attribution requires explicit operator policy", () => {
  assert.equal(orphanPolicy(0, {}), "none");
  assert.throws(() => orphanPolicy(3, {}), /tables=3.*MIGRATION_ORPHAN_ORG_ID.*MIGRATION_ALLOW_ORPHAN_DELETE/);
  assert.throws(() => orphanPolicy(1, { MIGRATION_ALLOW_ORPHAN_DELETE: "false" }));
  assert.equal(orphanPolicy(3, { MIGRATION_ORPHAN_ORG_ID: "chosen-org" }), "map");
  assert.equal(orphanPolicy(3, { MIGRATION_ALLOW_ORPHAN_DELETE: "true" }), "delete");
  assert.equal(orphanPolicy(3, { MIGRATION_ORPHAN_ORG_ID: "chosen-org", MIGRATION_ALLOW_ORPHAN_DELETE: "true" }), "map");
});

test("0004 SQL cannot assign or delete tenant data", () => {
  const sql = fs.readFileSync(new URL("../../drizzle/0004_org_required.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /\b(UPDATE|DELETE)\b/i);
  assert.match(sql, /ALTER TABLE tables ALTER COLUMN organization_id SET NOT NULL/);
});
