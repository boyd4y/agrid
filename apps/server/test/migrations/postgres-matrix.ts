// Optional disposable-DB matrix. Requires CREATEDB on MIGRATION_TEST_DATABASE_URL.
import postgres from "postgres";
import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { runMigrations } from "../../src/db/migrate.js";

const url = new URL(process.env.MIGRATION_TEST_DATABASE_URL ?? "postgresql://tableapp:tableapp@localhost:5432/tableapp");
const admin = postgres(url.toString(), { max: 1 });
const database = `migration_matrix_${process.pid}_agent_test`;
const folder = new URL("../../drizzle/", import.meta.url);
const { entries } = JSON.parse(fs.readFileSync(new URL("meta/_journal.json", folder), "utf8"));
const saved = [process.env.MIGRATION_ORPHAN_ORG_ID, process.env.MIGRATION_ALLOW_ORPHAN_DELETE];
delete process.env.MIGRATION_ORPHAN_ORG_ID;
delete process.env.MIGRATION_ALLOW_ORPHAN_DELETE;
let sql: ReturnType<typeof postgres> | undefined;
try {
  await admin.unsafe(`CREATE DATABASE "${database}"`);
  url.pathname = `/${database}`;
  sql = postgres(url.toString(), { max: 1 });
  await runMigrations(sql);
  const ledger = await sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`;
  assert.equal(ledger.length, entries.length);
  await runMigrations(sql);
  assert.deepEqual(await sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`, ledger);
  console.log("PASS empty + latest idempotent");

  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  await sql`DROP SCHEMA drizzle CASCADE`;
  await sql`CREATE SCHEMA drizzle`;
  await sql`CREATE TABLE drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
  for (const entry of entries.slice(0, 2)) {
    const raw = fs.readFileSync(new URL(`${entry.tag}.sql`, folder), "utf8");
    for (const stmt of raw.split("--> statement-breakpoint").filter((s: string) => s.trim())) await sql.unsafe(stmt);
    await sql`INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES (${createHash("sha256").update(raw).digest("hex")},${entry.when})`;
  }
  await sql`INSERT INTO public.tables(name) VALUES ('orphan')`;
  await assert.rejects(runMigrations(sql), /Orphan table counts: tables=1/);
  assert.equal((await sql`SELECT * FROM drizzle.__drizzle_migrations`).length, 2);
  assert.equal((await sql`SELECT to_regclass('public.automations') AS reg`)[0].reg, null);
  process.env.MIGRATION_ORPHAN_ORG_ID = "missing-org";
  await assert.rejects(runMigrations(sql), /does not identify an existing organization/);
  await sql`INSERT INTO organization(id,name,slug) VALUES ('explicit-org','Explicit','explicit')`;
  process.env.MIGRATION_ORPHAN_ORG_ID = "explicit-org";
  await runMigrations(sql);
  assert.equal((await sql`SELECT organization_id FROM public.tables`)[0].organization_id, "explicit-org");
  assert.equal((await sql`SELECT * FROM drizzle.__drizzle_migrations`).length, entries.length);
  await sql`DROP INDEX public.rows_cells_gin_idx`;
  await runMigrations(sql);
  assert.ok((await sql`SELECT to_regclass('public.rows_cells_gin_idx') AS reg`)[0].reg);
  delete process.env.MIGRATION_ORPHAN_ORG_ID;
  process.env.MIGRATION_ALLOW_ORPHAN_DELETE = "true";
  await sql`ALTER TABLE public.tables ALTER COLUMN organization_id DROP NOT NULL`;
  await sql`INSERT INTO public.tables(name) VALUES ('delete-consented-orphan')`;
  await runMigrations(sql);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM public.tables WHERE organization_id IS NULL`)[0].count, 0);
  await sql`DROP TABLE public.automations CASCADE`;
  await assert.rejects(runMigrations(sql), /0003 tables missing after 0006/);
  console.log("PASS explicit deletion + unsafe queue-era gap abort");
  console.log("PASS 0001 watermark + orphan abort/rollback + invalid/valid mapping + latest gap repair");
} finally {
  if (saved[0] === undefined) delete process.env.MIGRATION_ORPHAN_ORG_ID; else process.env.MIGRATION_ORPHAN_ORG_ID = saved[0];
  if (saved[1] === undefined) delete process.env.MIGRATION_ALLOW_ORPHAN_DELETE; else process.env.MIGRATION_ALLOW_ORPHAN_DELETE = saved[1];
  await sql?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS "${database}"`);
  await admin.end();
}
