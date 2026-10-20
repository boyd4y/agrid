import assert from "node:assert/strict";
import { test } from "node:test";
import { pendingMigrations } from "../release/database.mjs";

test("migration plans accept migrator aliases, require explicit hash-bound compatibility, and reject gaps/unknown ledger", () => {
  const entries = [
    { idx: 0, tag: "0000_initial", when: 10, hash: "hash0" },
    { idx: 2, tag: "0002_perf", when: 20, hash: "hash2" },
    { idx: 6, tag: "0006_safe", when: 30, hash: "hash6" },
  ];
  for (const ledger of [
    entries.map(e => ({ hash: e.hash, created_at: 999 })),
    entries.map(e => ({ hash: e.tag, created_at: 999 })),
    entries.map(e => ({ hash: "legacy", created_at: e.when })),
    [{ hash: "0000_initial", created_at: 10 }, { hash: "old-hash", created_at: 1760160000000 }, { hash: "hash6", created_at: 30 }],
  ]) assert.deepEqual(pendingMigrations(entries, ledger, {}), []);
  const ledger = entries.slice(0, 2).map(e => ({ hash: e.hash, created_at: e.when }));
  assert.throws(() => pendingMigrations(entries, ledger, {}), /separate_compatibility/);
  const approval = { "0006_safe": { sha256: "hash6", compatibility: "backward-compatible", requiresWriterDrain: false } };
  assert.deepEqual(pendingMigrations(entries, ledger, approval), ["0006_safe"]);
  assert.throws(() => pendingMigrations(entries, ledger, { "0006_safe": { ...approval["0006_safe"], sha256: "modified" } }));
  assert.throws(() => pendingMigrations(entries, ledger, { "0006_safe": { ...approval["0006_safe"], requiresWriterDrain: true } }));
  assert.throws(() => pendingMigrations(entries, [...ledger, { hash: "unknown", created_at: 999 }] , approval), /unknown_migration_ledger/);
  assert.throws(() => pendingMigrations(entries, [{ hash: "hash6" }], approval), /ledger_gap/);
});
