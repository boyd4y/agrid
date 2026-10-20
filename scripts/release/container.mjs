import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReleaseError } from "./guards.mjs";

const execute = promisify(execFile);

export async function pullImage(image, run = execute) {
  const dockerConfig = mkdtempSync(join(tmpdir(), "tabdo-release-docker-"));
  try {
    // A fresh config prevents credential helpers or an earlier package login
    // from turning this into an authenticated pull. Check every layer before
    // snapshot/migration/source mutation, including releases without migrations.
    await run("docker", ["--config", dockerConfig, "pull", image], {
      env: { PATH: process.env.PATH }, timeout: 300000, maxBuffer: 1024 * 1024,
    });
  } catch { throw new ReleaseError("anonymous_docker_pull_failed_no_production_changes"); }
  finally { rmSync(dockerConfig, { recursive: true, force: true }); }
}

export async function migrate(image, databaseUrl, run = execute) {
  const name = `tabdo-release-migrate-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  try {
    // Connection strings are environment-only. Never forward management tokens
    // or print captured migrator stdout/stderr (which can contain SQL/DSNs).
    await run("docker", ["run", "--rm", "--name", name, "-e", "DATABASE_URL", "-e", "DATABASE_URL_UNPOOLED", "-e", "NODE_ENV=production", "-e", "TABDO_ENV=production", image, "node", "dist/db/migrate.js"], {
      env: { PATH: process.env.PATH, DATABASE_URL: databaseUrl, DATABASE_URL_UNPOOLED: databaseUrl },
      timeout: 300000, maxBuffer: 1024 * 1024,
    });
  } catch { throw new ReleaseError("migration_failed_or_timed_out_no_deployment"); }
  finally {
    // A killed docker client does not kill its container. Bound that lifetime
    // too; do not claim that an unknown database outcome has been rolled back.
    await run("docker", ["rm", "--force", name], { env: { PATH: process.env.PATH }, timeout: 30000 }).catch(() => {});
  }
}
