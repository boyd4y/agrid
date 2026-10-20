import { defineRailway, preserve, project, service } from "railway/iac";

// Native GitHub autodeploys build master with Dockerfile.server without CI gating.
// Manage application services only; preserve external databases and secrets.
// Preview with `railway config plan`; production settings are applied by lead.
export const partial = "tabdo-app";

export default defineRailway(() => {

  // Secrets and the Neon connection string stay in Railway variables; the graph
  // only records that they exist, so `config plan` never rewrites them.
  const sharedEnv = {
    DATABASE_URL: preserve(),
    BETTER_AUTH_SECRET: preserve(),
    BETTER_AUTH_URL: preserve(),
    APP_URL: preserve(),
    INTEGRATION_ENCRYPTION_KEY: preserve(),
    REDIS_URL: "${{Redis.REDIS_URL}}",
    QUEUE_PREFIX: "tabdo-production",
    DB_POOL_MAX: "10",
    NODE_ENV: "production",
    TABDO_ENV: "production",
    HOST: "0.0.0.0",
    PORT: "3001",
    WEBHOOK_PUBLIC_URL: preserve(),
    AUTH_REQUIRED: "true",
    FILE_STORAGE_DRIVER: "s3",
    DATABASE_URL_UNPOOLED: preserve(),
    FILE_STORAGE_S3_BUCKET: preserve(),
    AWS_ENDPOINT_URL_S3: preserve(),
    AWS_REGION: preserve(),
    AWS_ACCESS_KEY_ID: preserve(),
    AWS_SECRET_ACCESS_KEY: preserve(),
    PI_API_KEY: preserve(),
    PI_BASE_URL: preserve(),
    PI_MODEL: preserve(),
  };

  const source = { type: "github" as const, repo: "boyd4y/agrid", branch: "master", checkSuites: false };
  const build = { dockerfilePath: "Dockerfile.server" };

  const api = service("api", {
    source, build,
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { preDeployCommand: ["node /app/scripts/release/predeploy.mjs"], preDeployTimeoutSeconds: 1200, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    start: "node dist/index.js",
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    env: {
      ...sharedEnv,
      NEON_API_KEY: preserve(),
      NEON_PROJECT_ID: preserve(),
      NEON_BRANCH_ID: preserve(),
      RELEASE_RAILWAY_PROJECT_ID: preserve(),
      RELEASE_RAILWAY_ENVIRONMENT_ID: preserve(),
      RELEASE_RAILWAY_API_SERVICE_ID: preserve(),
    },
  });

  // GitHub push deploys have no cross-service order. This read-only hook
  // waits for the API migration ledger before the new worker can start.
  const worker = service("worker", {
    source, build,
    replicas: { "asia-southeast1-eqsg3a": 1 },
    start: "node dist/queue/main.js",
    deploy: { preDeployCommand: ["node /app/scripts/release/predeploy.mjs --wait"], preDeployTimeoutSeconds: 1200, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    env: sharedEnv,
  });

  return project("tabdo", {
    resources: [api, worker],
  });
});
