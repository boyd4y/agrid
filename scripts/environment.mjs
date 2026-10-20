import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const localUrls = [
  "DATABASE_URL", "DATABASE_URL_UNPOOLED", "REDIS_URL",
  "QUEUE_DATABASE_URL", "QUEUE_REDIS_URL", "APP_URL", "BETTER_AUTH_URL",
  "TABDO_API_TARGET", "SITE_PUBLIC_ORIGIN",
];

/** Load exactly one environment file. Never fall back to the CLI-managed root .env. */
export function loadEnvironment({ root = repositoryRoot, env = process.env, mode = env.TABDO_ENV || env.NODE_ENV || "development" } = {}) {
  if (!["development", "production", "test"].includes(mode)) {
    throw new Error("Environment must be development, production, or test.");
  }
  let values = {};
  if (mode !== "test") {
    try {
      values = parseEnv(readFileSync(resolve(root, `.env.${mode}`), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  // NODE_ENV/TABDO_ENV select the scope; a file cannot change that scope.
  delete values.NODE_ENV;
  delete values.TABDO_ENV;
  const effective = { ...values, ...env };
  effective.TABDO_ENV = mode;
  if (!effective.NODE_ENV) effective.NODE_ENV = mode;
  if (mode === "development") {
    effective.DATABASE_URL ??= "postgresql://tableapp:tableapp@127.0.0.1:5432/tableapp";
    effective.REDIS_URL ??= "redis://127.0.0.1:6380";
    effective.QUEUE_PREFIX ??= "tabdo-development";
    for (const key of localUrls) {
      if (!effective[key]) continue;
      let url;
      try { url = new URL(effective[key]); } catch { /* Report the variable, never its credentials. */ }
      if (!url || !localHosts.has(url.hostname) || (key.includes("DATABASE") && !["postgres:", "postgresql:"].includes(url.protocol)) || (key.includes("REDIS") && !["redis:", "rediss:"].includes(url.protocol))) {
        throw new Error(`Development requires a local ${key}. Update .env.development; remote services belong in production.`);
      }
    }
    if (effective.FILE_STORAGE_DRIVER && effective.FILE_STORAGE_DRIVER !== "local") {
      throw new Error("Development requires FILE_STORAGE_DRIVER=local. Remote file storage belongs in production.");
    }
    effective.FILE_STORAGE_DRIVER = "local";
  }
  Object.assign(env, effective);
  return mode;
}
