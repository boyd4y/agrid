import "../load-env.js";
import postgres from "postgres";
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");
type Entry = { idx: number; tag: string; when: number };
type Sql = ReturnType<typeof postgres>;

export function orphanPolicy(count: number, env: NodeJS.ProcessEnv): "none" | "map" | "delete" {
  if (!count) return "none";
  if (env.MIGRATION_ORPHAN_ORG_ID) return "map";
  if (env.MIGRATION_ALLOW_ORPHAN_DELETE === "true") return "delete";
  throw new Error(`Orphan table counts: tables=${count} (organization_id IS NULL). Back up first, then set MIGRATION_ORPHAN_ORG_ID to an existing organization id or MIGRATION_ALLOW_ORPHAN_DELETE=true. No tenant was assigned and no rows were deleted.`);
}

async function resolveOrphans(sql: Sql) {
  // Prevent concurrent writes between counting, attribution and SET NOT NULL.
  await sql`LOCK TABLE public.tables IN ACCESS EXCLUSIVE MODE`;
  const [{ count }] = await sql`SELECT count(*)::integer AS count FROM public.tables WHERE organization_id IS NULL`;
  const policy = orphanPolicy(count, process.env);
  if (policy === "map") {
    const id = process.env.MIGRATION_ORPHAN_ORG_ID!;
    const organizations = await sql`SELECT id FROM public.organization WHERE id = ${id} FOR KEY SHARE`;
    if (!organizations.length) throw new Error(`MIGRATION_ORPHAN_ORG_ID=${id} does not identify an existing organization; no orphan data changed.`);
    await sql`UPDATE public.tables SET organization_id = ${id} WHERE organization_id IS NULL`;
    console.log(`Migration orphan attribution: mapped tables=${count} to organization=${id} (commits with 0004)`);
  } else if (policy === "delete") {
    // These queue-era references deliberately have no FK after 0006. Delete
    // explicitly; all other table references follow their declared FK actions.
    for (const table of ["automation_runs", "automation_events", "automations", "rows", "columns"]) {
      const [{ present }] = await sql`SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS present`;
      if (present) {
        const deleted = await sql.unsafe(`DELETE FROM public."${table}" WHERE table_id IN (SELECT id FROM public.tables WHERE organization_id IS NULL) RETURNING id`);
        console.log(`Migration orphan deletion: ${table}=${deleted.length} (commits with 0004)`);
      }
    }
    await sql`DELETE FROM public.tables WHERE organization_id IS NULL`;
    console.log(`Migration orphan deletion: tables=${count}; dependent data follows FK cascade/SET NULL (commits with 0004)`);
  }
}

async function historicalGap(sql: Sql, idx: number): Promise<boolean> {
  if (idx === 2) {
    const [{ ready }] = await sql`SELECT
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rows' AND column_name='version')
      AND to_regclass('public.rows_table_sort_id_idx') IS NOT NULL
      AND to_regclass('public.rows_cells_gin_idx') IS NOT NULL
      AND to_regclass('public.columns_table_sort_idx') IS NOT NULL AS ready`;
    return !ready;
  }
  if (idx === 3 || idx === 5) {
    const names = idx === 3 ? ["automations", "automation_runs"] : ["table_views"];
    for (const name of names) {
      const [{ present }] = await sql`SELECT to_regclass(${`public.${name}`}) IS NOT NULL AS present`;
      if (!present) {
        // Recreating 0003 after queue migrations would reintroduce removed FKs
        // and leave queue/event columns missing. Require operator recovery.
        if (idx === 3) {
          const [{ queued }] = await sql`SELECT to_regclass('public.automation_events') IS NOT NULL AS queued`;
          if (queued) throw new Error("0003 tables missing after 0006+: restore a backup or audit/rebuild the automation schema before retrying pnpm db:migrate; replaying 0003 alone is unsafe.");
        }
        return true;
      }
    }
    return false;
  }
  if (idx === 4) {
    const [column] = await sql`SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='tables' AND column_name='organization_id'`;
    return column?.is_nullable !== "NO";
  }
  return false;
}

export async function runMigrations(sql: Sql, folder = migrationsFolder) {
  const { entries } = JSON.parse(fs.readFileSync(path.join(folder, "meta/_journal.json"), "utf8")) as { entries: Entry[] };
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].idx <= entries[i - 1].idx || entries[i].when <= entries[i - 1].when) throw new Error("Migration journal must have strictly increasing idx and when");
  }
  await sql.begin(async (tx) => {
    // One runner owns the ledger and schema until all entries commit; failure
    // rolls back repairs too. No timestamp watermark can skip a later entry.
    await tx`SELECT pg_advisory_xact_lock(1791690608)`;
    await tx`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await tx`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
    const connection = tx as unknown as Sql;
    for (const entry of entries) {
      const raw = fs.readFileSync(path.join(folder, `${entry.tag}.sql`), "utf8");
      const hash = createHash("sha256").update(raw).digest("hex");
      // Timestamp equality recognizes legacy Drizzle records (including the
      // original 0002–0005 timestamps); it is never used as a range/watermark.
      const legacyWhen = entry.idx >= 2 && entry.idx <= 5 ? 1760160000000 + (entry.idx - 2) * 10000000 : entry.when;
      const recorded = await tx`SELECT id FROM drizzle.__drizzle_migrations WHERE hash = ${hash} OR hash = ${entry.tag} OR created_at = ${entry.when} OR created_at = ${legacyWhen}`;
      const gap = await historicalGap(connection, entry.idx);
      if (recorded.length && !gap) continue;
      if (entry.idx === 4 && gap) await resolveOrphans(connection);
      console.log(`Applying ${entry.tag}${gap ? " (schema repair)" : ""}`);
      if (entry.idx < 2 || entry.idx > 5 || gap) {
        for (const statement of raw.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) await tx.unsafe(statement);
      }
      // Existing ledger history remains intact. Repairs append real content
      // hashes and the journal timestamp, never wall-clock time.
      await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT ${hash}, ${entry.when} WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = ${hash} AND created_at = ${entry.when})`;
    }
  });
}

async function main() {
  // Neon: run migrations over the direct endpoint. The pooled (-pooler) host is
  // PgBouncer in transaction mode, which drops session-level state that DDL relies on.
  const sql = postgres(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "postgresql://tableapp:tableapp@localhost:5432/tableapp", { max: 1 });
  try {
    await runMigrations(sql);
    console.log("Migrations complete");
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error("Migration failed; transaction rolled back:", error); process.exitCode = 1; });
}
