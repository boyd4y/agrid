import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ReleaseError, requireRelease, releaseEvent, productionConfig, shaPattern } from "./guards.mjs";
import { verifyGit } from "./git.mjs";
import { createPlatforms } from "./platforms.mjs";
import { prepareSource, createUploader } from "./source.mjs";

export async function runRelease({ env, event, ports, save = () => {} }) {
  const result = { status: "failed", stage: "authorization", previous: [], deployments: [] };
  let changedProduction = false;
  const record = stage => { result.stage = stage; save(result); };
  try {
    let release = releaseEvent(event, env);
    requireRelease(shaPattern.test(env.RELEASE_TAG_OID), "authorization_tag_pin_required");
    release.tagOid = env.RELEASE_TAG_OID;
    const config = productionConfig(env);
    release = await ports.verifyGit(release);
    Object.assign(result, release);
    record("export_source");
    result.source = await ports.prepareSource(release.sha);
    requireRelease(result.source.sha === release.sha && /^[a-f0-9]{64}$/.test(result.source.manifestSha256), "upload_source_evidence_required");
    record("production_target_preflight");
    result.previous = await ports.preflight();
    await ports.smoke();
    for (const [index, serviceId] of config.services.entries()) {
      record(index === 0 ? "deploy_api" : "deploy_worker");
      await ports.verifyGit(release);
      changedProduction = true;
      const remember = id => {
        requireRelease(/^[a-zA-Z0-9-]{1,80}$/.test(id), "invalid_deployment_id_outcome_unknown");
        requireRelease(!result.deployments.some(value => value.serviceId === serviceId), "duplicate_deployment_outcome_unknown");
        result.deployments.push({ serviceId, deploymentId: id, manifestSha256: result.source.manifestSha256 });
        save(result);
      };
      const id = await ports.deploy(serviceId, release, remember);
      if (!result.deployments.some(value => value.serviceId === serviceId)) remember(id);
      requireRelease(result.deployments.find(value => value.serviceId === serviceId).deploymentId === id, "deployment_id_readback_mismatch");
      await ports.wait(serviceId, id);
      if (index === 0) await ports.smoke();
    }
    record("verification");
    // Recheck both exact deployments after the second service finishes. A late
    // API crash or another source edit must not result in a successful release.
    for (const value of result.deployments) await ports.wait(value.serviceId, value.deploymentId);
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
    result.recovery = "Inspect exact deployment IDs and API preDeploy logs (including snapshot ID). Confirm migration compatibility and canRollback before any separately authorized recovery. Never restore the database automatically.";
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
    const platforms = createPlatforms(process.env, config, fetch, { attempts: 360 });
    let source;
    const ports = { ...platforms, verifyGit,
      prepareSource: sha => {
        source = prepareSource(sha);
        writeFileSync(".release/source-manifest.json", `${JSON.stringify(source.manifest, null, 2)}\n`, { mode: 0o600 });
        return { sha, manifestSha256: source.manifestSha256, fileCount: source.manifest.files.length };
      },
      deploy: (...args) => createUploader(process.env, config, source)(...args),
    };
    let result;
    try {
      result = await runRelease({ env: process.env, event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")), ports, save });
    } finally { source?.cleanup(); }
    console.log(JSON.stringify(result));
    if (result.status !== "success") process.exitCode = 1;
  } catch (error) {
    const result = { status: "failed_before_application_deploy", stage: "configuration", error: error instanceof ReleaseError ? error.code : "release_configuration_failed_details_suppressed" };
    save(result); console.error(JSON.stringify(result)); process.exitCode = 1;
  }
}
