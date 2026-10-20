export class ReleaseError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function requireRelease(condition, code) {
  if (!condition) throw new ReleaseError(code);
}

export const shaPattern = /^[a-f0-9]{40}$/;
export const digestPattern = /^sha256:[a-f0-9]{64}$/;
export const versionPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function releaseEvent(event, env) {
  requireRelease(env.GITHUB_EVENT_NAME === "push" && env.GITHUB_REF_TYPE === "tag", "tag_push_required");
  const version = env.GITHUB_REF?.replace(/^refs\/tags\//, "");
  requireRelease(versionPattern.test(version) && env.GITHUB_REF === `refs/tags/${version}`, "stable_semver_tag_required");
  requireRelease(event.created === true && !event.deleted && !event.forced, "new_unmodified_tag_required");
  requireRelease(shaPattern.test(env.GITHUB_SHA) && shaPattern.test(event.after), "invalid_commit");
  requireRelease(env.GITHUB_REPOSITORY === "boyd4y/agrid", "repository_mismatch");
  // These are event object IDs until verifyGit resolves/pins the commit and tag.
  return { version, sha: env.GITHUB_SHA, tagOid: event.after };
}

export function productionConfig(env) {
  requireRelease(env.RELEASE_BOOTSTRAP_READY === "true", "bootstrap_not_ready_see_docs_releases");
  requireRelease(env.RELEASE_ENVIRONMENT === "tabdo / production", "production_environment_required");
  const keys = ["RAILWAY_API_TOKEN", "NEON_API_KEY", "RELEASE_DATABASE_URL", "RAILWAY_PROJECT_ID", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_API_SERVICE_ID", "RAILWAY_WORKER_SERVICE_ID", "NEON_PROJECT_ID", "NEON_BRANCH_ID", "RELEASE_PUBLIC_URL"];
  for (const key of keys) requireRelease(typeof env[key] === "string" && env[key].length > 0, `missing_${key}`);
  const id = /^[a-zA-Z0-9-]{1,80}$/;
  for (const key of keys.filter(key => key.endsWith("_ID"))) requireRelease(id.test(env[key]), "invalid_target_id");
  requireRelease(env.RAILWAY_API_SERVICE_ID !== env.RAILWAY_WORKER_SERVICE_ID, "distinct_services_required");
  let publicUrl, database;
  try { publicUrl = new URL(env.RELEASE_PUBLIC_URL); database = new URL(env.RELEASE_DATABASE_URL); } catch { throw new ReleaseError("invalid_target_url"); }
  requireRelease(publicUrl.protocol === "https:" && !publicUrl.username && !publicUrl.password && publicUrl.pathname === "/" && !publicUrl.search && !publicUrl.hash, "public_https_origin_required");
  requireRelease(["postgres:", "postgresql:"].includes(database.protocol) && database.hostname.endsWith(".neon.tech") && !database.hostname.includes("-pooler.") && database.pathname.length > 1 && database.searchParams.get("sslmode") === "require", "direct_neon_database_required");
  requireRelease(!env.MIGRATION_ALLOW_ORPHAN_DELETE && !env.MIGRATION_ORPHAN_ORG_ID, "special_migration_plan_required");
  return {
    projectId: env.RAILWAY_PROJECT_ID, environmentId: env.RAILWAY_ENVIRONMENT_ID,
    services: [env.RAILWAY_API_SERVICE_ID, env.RAILWAY_WORKER_SERVICE_ID],
    neonProjectId: env.NEON_PROJECT_ID, neonBranchId: env.NEON_BRANCH_ID,
    publicUrl: publicUrl.origin, databaseUrl: env.RELEASE_DATABASE_URL,
  };
}

export function databaseIdentity(value) {
  try {
    const url = new URL(value);
    requireRelease(["postgres:", "postgresql:"].includes(url.protocol), "database_target_mismatch");
    return `${url.hostname.replace(/-pooler\./, ".")}:${url.port || "5432"}${url.pathname}:${url.username}`;
  } catch { throw new ReleaseError("database_target_mismatch"); }
}

export function checkRuntimeVariables(values, config) {
  requireRelease(values.TABDO_ENV === "production" && values.NODE_ENV === "production" && values.AUTH_REQUIRED === "true" && values.QUEUE_PREFIX === "tabdo-production", "runtime_environment_mismatch");
  for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
    requireRelease(values[key] && databaseIdentity(values[key]) === databaseIdentity(config.databaseUrl), "database_target_mismatch");
  }
  requireRelease(!new URL(values.DATABASE_URL_UNPOOLED).hostname.includes("-pooler."), "runtime_direct_database_required");
  requireRelease(new URL(values.APP_URL).origin === config.publicUrl && new URL(values.BETTER_AUTH_URL).origin === config.publicUrl, "runtime_origin_mismatch");
}
