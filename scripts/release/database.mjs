import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { requireRelease } from "./guards.mjs";

const requireServer = createRequire(new URL("../../apps/server/package.json", import.meta.url));

export function pendingMigrations(entries, ledger, approvals) {
  // Match the existing migrator's historical aliases, including 0002–0005's
  // original timestamps. Its ledger is not necessarily one row per migration.
  const recorded = (entry, row) => row.hash === entry.hash || row.hash === entry.tag || Number(row.created_at) === entry.when || (entry.idx >= 2 && entry.idx <= 5 && Number(row.created_at) === 1760160000000 + (entry.idx - 2) * 10000000);
  requireRelease(ledger.every(row => entries.some(entry => recorded(entry, row))), "unknown_migration_ledger_requires_audit");
  const pending = entries.filter(entry => !ledger.some(row => recorded(entry, row)));
  requireRelease(!pending.some(entry => entries.some(later => later.idx > entry.idx && ledger.some(row => recorded(later, row)))), "migration_ledger_gap_requires_audit");
  for (const entry of pending) {
    // Hash-specific review is required. No SQL keyword heuristic can prove that
    // a data migration is safe while the previous API and worker keep writing.
    requireRelease(entry.idx > 5 && approvals[entry.tag]?.sha256 === entry.hash && approvals[entry.tag]?.compatibility === "backward-compatible" && approvals[entry.tag]?.requiresWriterDrain === false, "migration_requires_separate_compatibility_plan");
  }
  return pending.map(entry => entry.tag);
}

export async function migrationPlan(databaseUrl) {
  const postgres = requireServer("postgres");
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 15, connection: { statement_timeout: 30000 } });
  try {
    const folder = new URL("../../apps/server/drizzle/", import.meta.url);
    const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", folder), "utf8"));
    const entries = journal.entries.map(entry => ({ ...entry, hash: createHash("sha256").update(readFileSync(new URL(`${entry.tag}.sql`, folder))).digest("hex") }));
    const ledger = await sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations`;
    // The existing migrator can repair 0002–0005 even when recorded. A release
    // must not accidentally invoke that repair while old writers are running.
    const [historical] = await sql`SELECT
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rows' AND column_name='version')
      AND to_regclass('public.rows_table_sort_id_idx') IS NOT NULL
      AND to_regclass('public.rows_cells_gin_idx') IS NOT NULL
      AND to_regclass('public.columns_table_sort_idx') IS NOT NULL
      AND to_regclass('public.automations') IS NOT NULL
      AND to_regclass('public.automation_runs') IS NOT NULL
      AND to_regclass('public.table_views') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tables' AND column_name='organization_id' AND is_nullable='NO') AS ready`;
    requireRelease(historical.ready === true, "historical_schema_repair_requires_separate_plan");
    return pendingMigrations(entries, ledger, JSON.parse(readFileSync(new URL("migrations.json", import.meta.url), "utf8")));
  } finally { await sql.end({ timeout: 5 }); }
}
