import { defineRailway, github, preserve, project, service } from "railway/iac";

// Railway infrastructure as code. Replaces the deprecated railway.api.json /
// railway.worker.json Config as Code files, which new services can no longer opt
// into and which stop being read on 2026-12-01.
//
// API and worker build the same monorepo image (Dockerfile.server) and share one
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

  const dockerBuild = { builder: "DOCKERFILE", dockerfilePath: "Dockerfile.server" } as const;

  const api = service("api", {
    source: github("boyd4y/agrid", { branch: "master", checkSuites: true }),
    build: dockerBuild,
    replicas: { "asia-southeast1-eqsg3a": 1 },
    // Migrations fall back to DATABASE_URL; set DATABASE_URL_UNPOOLED to use
    // Neon's direct endpoint for schema changes.
    preDeploy: "node dist/db/migrate.js",
    start: "node dist/index.js",
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    env: sharedEnv,
  });

  const worker = service("worker", {
    source: github("boyd4y/agrid", { branch: "master", checkSuites: true }),
    build: dockerBuild,
    replicas: { "asia-southeast1-eqsg3a": 1 },
    start: "node dist/queue/main.js",
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    env: sharedEnv,
  });

  return project("tabdo", {
    resources: [api, worker],
  });
});
