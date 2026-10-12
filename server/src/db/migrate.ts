import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const connectionString =
    process.env.DATABASE_URL ??
    "postgresql://tableapp:tableapp@localhost:5432/tableapp";
  const migrationClient = postgres(connectionString, { max: 1 });
  const db = drizzle(migrationClient);
  const migrationsFolder = path.resolve(__dirname, "../../drizzle");
  console.log("Running migrations from", migrationsFolder);
  await migrate(db, { migrationsFolder });

  // Fallback for hand-authored 0003 (tag-as-hash style journals)
  const [{ reg }] = await migrationClient`
    SELECT to_regclass('public.automations') AS reg
  `;
  if (!reg) {
    const sqlPath = path.join(migrationsFolder, "0003_automations.sql");
    const raw = fs.readFileSync(sqlPath, "utf8");
    for (const stmt of raw.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
      await migrationClient.unsafe(stmt);
    }
    await migrationClient`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      SELECT '0003_automations', ${Date.now()}
      WHERE NOT EXISTS (
        SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '0003_automations'
      )
    `;
    console.log("Applied fallback 0003_automations.sql");
  }

  // Fallback for hand-authored 0004 (org_id NOT NULL)
  const [{ nullable }] = await migrationClient`
    SELECT is_nullable AS nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tables'
      AND column_name = 'organization_id'
  `;
  if (nullable === "YES") {
    const sqlPath = path.join(migrationsFolder, "0004_org_required.sql");
    const raw = fs.readFileSync(sqlPath, "utf8");
    for (const stmt of raw.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
      await migrationClient.unsafe(stmt);
    }
    await migrationClient`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      SELECT '0004_org_required', ${Date.now()}
      WHERE NOT EXISTS (
        SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '0004_org_required'
      )
    `;
    console.log("Applied fallback 0004_org_required.sql");
  }


  // Fallback for hand-authored 0005 (table_views)
  const [{ viewsReg }] = await migrationClient`
    SELECT to_regclass('public.table_views') AS "viewsReg"
  `;
  if (!viewsReg) {
    const sqlPath = path.join(migrationsFolder, "0005_table_views.sql");
    const raw = fs.readFileSync(sqlPath, "utf8");
    for (const stmt of raw.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
      await migrationClient.unsafe(stmt);
    }
    await migrationClient`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      SELECT '0005_table_views', ${Date.now()}
      WHERE NOT EXISTS (
        SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '0005_table_views'
      )
    `;
    console.log("Applied fallback 0005_table_views.sql");
  }

  console.log("Migrations complete");

  await migrationClient.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
