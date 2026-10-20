import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ReleaseError, requireRelease, releaseEvent, productionConfig, digestPattern, shaPattern } from "./guards.mjs";
import { verifyGit } from "./git.mjs";
import { createPlatforms } from "./platforms.mjs";
import { migrationPlan } from "./database.mjs";
import { pullImage, migrate } from "./container.mjs";

export async function runRelease({ env, event, ports, save = () => {} }) {
  const result = { status: "failed", stage: "authorization", previous: [], deployments: [], backupId: null };
  let changedProduction = false;
  const record = stage => { result.stage = stage; save(result); };
  try {
    let release = releaseEvent(event, env);
    requireRelease(shaPattern.test(env.RELEASE_TAG_OID), "authorization_tag_pin_required");
    release.tagOid = env.RELEASE_TAG_OID;
    const config = productionConfig(env);
    requireRelease(digestPattern.test(env.RELEASE_IMAGE_DIGEST), "invalid_image_digest");
    const image = `ghcr.io/boyd4y/agrid@${env.RELEASE_IMAGE_DIGEST}`;
    result.image = image;
    release = await ports.verifyGit(release);
    Object.assign(result, release);
    record("anonymous_image_preflight");
    await ports.anonymousImage(image, release.sha);
    record("production_target_preflight");
    result.previous = await ports.preflight();
    await ports.smoke();
    record("migration_plan");
    const pending = await ports.migrationPlan(config.databaseUrl);
    result.pendingMigrations = pending;
    // Recheck the remote tag immediately before the first production mutation.
    await ports.verifyGit(release);
    if (pending.length) {
      record("backup");
      result.backupId = await ports.snapshot(release.version, id => { result.backupId = id; save(result); });
      record("migration");
      changedProduction = true;
      await ports.migrate(image, config.databaseUrl);
      requireRelease((await ports.migrationPlan(config.databaseUrl)).length === 0, "migration_readback_incomplete");
    }
    for (const [index, serviceId] of config.services.entries()) {
      record(index === 0 ? "deploy_api" : "deploy_worker");
      changedProduction = true;
      const id = await ports.deploy(serviceId, image);
      requireRelease(/^[a-zA-Z0-9-]{1,80}$/.test(id), "invalid_deployment_id_outcome_unknown");
      result.deployments.push({ serviceId, deploymentId: id });
      save(result);
      await ports.wait(serviceId, id, image);
      if (index === 0) await ports.smoke();
    }
    record("verification");
    // Recheck both exact deployments after the second service finishes. A late
    // API crash or another source edit must not result in a successful release.
    for (const value of result.deployments) await ports.wait(value.serviceId, value.deploymentId, image);
    await ports.smoke();
    await ports.verifyGit(release);
    result.status = "success";
    record("complete");
  } catch (error) {
    result.error = error instanceof ReleaseError ? error.code : "release_operation_failed_details_suppressed";
    result.status = changedProduction ? "manual_recovery_required" : "failed_before_application_deploy";
    // No automatic database restore, and no optimistic rollback claim. Railway
    // rollback availability depends on retention and the previous deployment's
    // hooks; an old hook could run migrations again. Preserve exact IDs for a
    // separately authorized operator decision, including uncertain requests.
    result.recovery = "Inspect deployment IDs and current service source in Railway. After confirming canRollback and migration compatibility, use deploymentRollback on the previous ID; verify SUCCESS and health. Never restore the production database automatically. See docs/releases.md.";
    save(result);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // This entry point intentionally has no dotenv loader and no local deploy
  // mode. Tests inject ports into runRelease and cannot access real services.
  mkdirSync(".release", { recursive: true, mode: 0o700 });
  const save = result => writeFileSync(".release/result.json", `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  try {
    const config = productionConfig(process.env);
    const platforms = createPlatforms(process.env, config);
    const ports = { ...platforms, verifyGit, migrationPlan, migrate, anonymousImage: async (image, sha) => {
      await platforms.anonymousImage(image, sha);
      await pullImage(image);
    } };
    const result = await runRelease({ env: process.env, event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")), ports, save });
    console.log(JSON.stringify(result));
    if (result.status !== "success") process.exitCode = 1;
  } catch (error) {
    const result = { status: "failed_before_application_deploy", stage: "configuration", error: error instanceof ReleaseError ? error.code : "release_configuration_failed_details_suppressed" };
    save(result); console.error(JSON.stringify(result)); process.exitCode = 1;
  }
}
