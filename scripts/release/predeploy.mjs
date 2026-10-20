import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { requireRelease, ReleaseError, databaseIdentity } from "./guards.mjs";
import { migrationPlan } from "./database.mjs";
import { createNeon } from "./platforms.mjs";

const execute = promisify(execFile);

export function predeployConfig(env) {
  for (const key of ["PROJECT_ID", "ENVIRONMENT_ID", "API_SERVICE_ID"]) {
    const expected = env[`RELEASE_RAILWAY_${key}`];
    const actual = env[`RAILWAY_${key === "API_SERVICE_ID" ? "SERVICE_ID" : key}`];
    requireRelease(expected && expected === actual, "predeploy_railway_target_mismatch");
  }
  requireRelease(env.RAILWAY_DEPLOYMENT_ID && env.NODE_ENV === "production" && env.TABDO_ENV === "production", "predeploy_production_runtime_required");
  requireRelease(!env.MIGRATION_ALLOW_ORPHAN_DELETE && !env.MIGRATION_ORPHAN_ORG_ID, "special_migration_plan_required");
  requireRelease(env.NEON_API_KEY && [env.NEON_PROJECT_ID, env.NEON_BRANCH_ID].every(value => typeof value === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(value)), "predeploy_neon_config_required");
  let url;
  try { url = new URL(env.DATABASE_URL_UNPOOLED); } catch { throw new ReleaseError("direct_neon_database_required"); }
  requireRelease(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname.endsWith(".neon.tech") && !url.hostname.includes("-pooler.") && url.pathname.length > 1 && url.searchParams.get("sslmode") === "require", "direct_neon_database_required");
  requireRelease(databaseIdentity(env.DATABASE_URL) === databaseIdentity(url.href), "database_target_mismatch");
  return { databaseUrl: url.href, neonProjectId: env.NEON_PROJECT_ID, neonBranchId: env.NEON_BRANCH_ID };
}

export async function migrate(databaseUrl, run = execute) {
  try {
    // Reuse the built application's migrator exactly once. Its output may
    // contain SQL or connection details, so only report our bounded outcome.
    await run(process.execPath, [fileURLToPath(new URL("../../apps/server/dist/db/migrate.js", import.meta.url))], {
      cwd: fileURLToPath(new URL("../../apps/server/", import.meta.url)),
      env: { PATH: process.env.PATH, NODE_ENV: "production", TABDO_ENV: "production", DATABASE_URL: databaseUrl, DATABASE_URL_UNPOOLED: databaseUrl },
      timeout: 300000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
    });
  } catch { throw new ReleaseError("migration_failed_or_timed_out_outcome_unknown"); }
}

export async function runPredeploy({ env, ports, save = () => {} }) {
  const result = { status: "failed", stage: "target", backupId: null };
  const stage = name => { result.stage = name; save(result); };
  try {
    const config = predeployConfig(env);
    await ports.verifyTarget();
    stage("plan");
    const pending = await ports.migrationPlan(config.databaseUrl);
    result.pendingMigrations = pending;
    if (pending.length) {
      stage("backup");
      result.backupId = await ports.snapshot(env.RAILWAY_DEPLOYMENT_ID, id => { result.backupId = id; save(result); });
      stage("migration");
      await ports.migrate(config.databaseUrl);
      stage("readback");
      requireRelease((await ports.migrationPlan(config.databaseUrl)).length === 0, "migration_readback_incomplete");
    }
    result.status = "success";
    stage("complete");
  } catch (error) {
    result.error = error instanceof ReleaseError ? error.code : "predeploy_failed_details_suppressed";
    save(result);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const save = result => console.log(JSON.stringify({ releasePredeploy: result }));
  // A platform timeout also applies, but bound our entire process independently.
  const deadline = setTimeout(() => { save({ status: "failed", error: "predeploy_timeout_outcome_unknown" }); process.exit(1); }, 1080000);
  try {
    const config = predeployConfig(process.env);
    const ports = { ...createNeon(process.env, config), migrationPlan, migrate };
    const result = await runPredeploy({ env: process.env, ports, save });
    if (result.status !== "success") process.exitCode = 1;
  } catch (error) {
    save({ status: "failed", error: error instanceof ReleaseError ? error.code : "predeploy_configuration_failed_details_suppressed" });
    process.exitCode = 1;
  } finally { clearTimeout(deadline); }
}
