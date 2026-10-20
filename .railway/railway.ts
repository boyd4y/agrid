import { defineRailway, preserve, project, service } from "railway/iac";

// Railway infrastructure as code. Replaces the deprecated railway.api.json /
// railway.worker.json Config as Code files, which new services can no longer opt
// into and which stop being read on 2026-12-01.
//
// Release builds one monorepo image (Dockerfile.server); API and worker share one
// environment contract. Postgres lives on Neon; Railway owns only Redis.
// Preview with `railway config plan`. Do not `config apply` without review.
// Manage only Tabdo application services; existing data services remain untouched.
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

  // Release owns immutable image sources. Omitting source leaves it unmanaged
  // by IaC; it does NOT disconnect existing master autodeploys on the platform.
  // Admin bootstrap must disconnect them and remove old pre-deploy migrations.
  const api = service("api", {
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { preDeployCommand: [], restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    start: "node dist/index.js",
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    env: sharedEnv,
  });

  const worker = service("worker", {
    replicas: { "asia-southeast1-eqsg3a": 1 },
    start: "node dist/queue/main.js",
    deploy: { preDeployCommand: [], restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    env: sharedEnv,
  });

  return project("tabdo", {
    resources: [api, worker],
  });
});
