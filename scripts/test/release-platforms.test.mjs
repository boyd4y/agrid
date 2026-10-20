import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlatforms, poll } from "../release/platforms.mjs";

const databaseUrl = "postgresql://owner:private@ep-demo.eu-central-1.aws.neon.tech/db?sslmode=require";
const config = { projectId: "project", environmentId: "production", services: ["api", "worker"], publicUrl: "https://tabdo.example" };
const env = { RAILWAY_API_TOKEN: "project-secret" };
const json = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const fast = { attempts: 3, intervalMs: 0 };

function fixture(overrides = {}) {
  const calls = [];
  let pollIndex = 0;
  const deployment = (serviceId, id, status = "SUCCESS") => ({ id, status, projectId: "project", environmentId: "production", serviceId, ...overrides.deployment });
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("backboard.railway.com")) {
      assert.equal(options.headers["Project-Access-Token"], "project-secret");
      assert(!options.headers.Authorization);
      assert.equal(options.redirect, "error");
      const { query, variables: args } = JSON.parse(options.body);
      assert(!query.startsWith("mutation"), "GQL is read only; CLI alone initiates a deployment");
      if (overrides.graphqlError) return json({ errors: [{ message: "postgres://private-secret" }] });
      if (query.startsWith("query Token")) return json({ data: { projectToken: { projectId: "project", environmentId: overrides.tokenEnvironment || "production" } } });
      if (query.startsWith("query Environment")) return json({ data: { environment: { id: "production", projectId: "project", deploymentTriggers: { edges: overrides.trigger ? [{ node: { serviceId: "api" } }] : [], pageInfo: { hasNextPage: false } } } } });
      if (query.startsWith("query Instance")) {
        const serviceId = args.serviceId;
        const id = overrides.currentId || `old-${serviceId}`;
        return json({ data: { serviceInstance: {
          serviceId, environmentId: "production", service: { projectId: "project" }, source: { repo: null, image: null },
          railwayConfigFile: serviceId === "api" ? "railway.api.json" : "railway.worker.json",
          startCommand: serviceId === "api" ? "node dist/index.js" : "node dist/queue/main.js", healthcheckPath: "/api/health",
          activeDeployments: [deployment(serviceId, id)], latestDeployment: { id }, ...overrides.instance,
        } } });
      }
      if (query.startsWith("query Variables")) return json({ data: { variables: {
        NODE_ENV: "production", TABDO_ENV: "production", AUTH_REQUIRED: "true", QUEUE_PREFIX: "tabdo-production",
        DATABASE_URL: databaseUrl, DATABASE_URL_UNPOOLED: databaseUrl, APP_URL: config.publicUrl, BETTER_AUTH_URL: config.publicUrl,
        RELEASE_RAILWAY_PROJECT_ID: "project", RELEASE_RAILWAY_ENVIRONMENT_ID: "production", RELEASE_RAILWAY_API_SERVICE_ID: "api",
        NEON_PROJECT_ID: "neon", NEON_BRANCH_ID: "branch", NEON_API_KEY: "private-neon", ...overrides.variables,
      } } });
      if (query.startsWith("query Deployment")) return json({ data: { deployment: deployment("api", args.id, (overrides.statuses || ["SUCCESS"])[pollIndex++] || "SUCCESS") } });
      assert.fail(query);
    }
    assert.equal(options.headers, undefined, "no credentials on public smoke requests");
    if (url.endsWith("/api/health")) return json({ ok: true, service: "tabdo", schema: { ok: overrides.schemaOk ?? true } });
    if (url.endsWith("/api/public/auth-features")) return json({ google: false });
    return new Response('<html><div id="root"></div></html>', { headers: { "content-type": "text/html" } });
  };
  return { calls, platforms: createPlatforms(env, config, fetcher, fast) };
}

test("preflight checks Project token, disconnected sources, IaC paths, stable services and runtime isolation", async () => {
  const f = fixture();
  assert.deepEqual(await f.platforms.preflight(), [{ serviceId: "api", deploymentId: "old-api" }, { serviceId: "worker", deploymentId: "old-worker" }]);
  for (const override of [
    { tokenEnvironment: "staging" }, { trigger: true }, { variables: { NEON_API_KEY: "" } },
    { variables: { DATABASE_URL: databaseUrl.replace("/db?", "/other?") } },
    { variables: { RELEASE_RAILWAY_API_SERVICE_ID: "other" } },
    { variables: { MIGRATION_ORPHAN_ORG_ID: "org" } },
    { instance: { source: { repo: "boyd4y/agrid" } } }, { instance: { source: { image: "old-image" } } },
    { instance: { rootDirectory: "/apps/server" } }, { instance: { railwayConfigFile: "wrong.json" } }, { instance: { activeDeployments: [] } },
  ]) await assert.rejects(() => fixture(override).platforms.preflight());
});

test("wait checks exact deployment target, SUCCESS and active/latest ID without invented commit metadata", async () => {
  await fixture({ currentId: "new-api", statuses: ["QUEUED", "BUILDING", "SUCCESS"] }).platforms.wait("api", "new-api");
  for (const override of [{ deployment: { serviceId: "worker" } }, { deployment: { projectId: "other" } }, { deployment: { environmentId: "other" } }, { deployment: { id: "other" } }, { statuses: ["FAILED"] }, { statuses: ["UNKNOWN"] }, { instance: { activeDeployments: [] } }, { currentId: "other" }]) {
    await assert.rejects(() => fixture({ currentId: "new-api", ...override }).platforms.wait("api", "new-api"));
  }
});

test("reads time out and raw GraphQL errors remain private", async () => {
  let reads = 0;
  await assert.rejects(() => poll(async () => { reads++; return "QUEUED"; }, () => false, fast), /timeout_outcome_unknown/);
  assert.equal(reads, 3);
  await assert.rejects(() => fixture({ graphqlError: true }).platforms.preflight(), error => {
    assert.doesNotMatch(error.message, /private-secret|postgres:/); return true;
  });
});

test("public smoke requires schema health, auth features and frontend", async () => {
  const f = fixture();
  await f.platforms.smoke();
  assert.equal(f.calls.length, 3);
  await assert.rejects(() => fixture({ schemaOk: false }).platforms.smoke(), /schema_health/);
});
