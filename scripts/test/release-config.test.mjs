import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import railway from "../../.railway/railway.ts";

test("native GitHub source deploys master without CI gating; API alone owns migration and Neon administration", () => {
  const services = railway().resources;
  assert.deepEqual(services.map(service => service.name), ["api", "worker"]);
  for (const service of services) {
    assert.deepEqual(service.source, { type: "github", repo: "boyd4y/agrid", branch: "master", checkSuites: false });
    assert.equal(service.build.dockerfilePath, "Dockerfile.server");
    assert.equal(service.deploy.preDeployTimeoutSeconds, 1200);
    const legacy = JSON.parse(readFileSync(new URL(`../../railway.${service.name}.json`, import.meta.url), "utf8"));
    assert.deepEqual(service.deploy.preDeployCommand, legacy.deploy.preDeployCommand);
    assert.equal(service.deploy.startCommand, legacy.deploy.startCommand);
  }
  const [api, worker] = services;
  assert.deepEqual(api.deploy.preDeployCommand, ["node /app/scripts/release/predeploy.mjs"]);
  assert.deepEqual(worker.deploy.preDeployCommand, ["node /app/scripts/release/predeploy.mjs --wait"]);
  assert(api.variables.NEON_API_KEY);
  assert.equal(worker.variables.NEON_API_KEY, undefined);
  assert.equal(worker.variables.NEON_PROJECT_ID, undefined);
  assert.equal(worker.variables.NEON_BRANCH_ID, undefined);
});

test("delivery has no GitHub Actions workflows or source upload machinery", () => {
  const folder = new URL("../../.github/workflows/", import.meta.url);
  assert.deepEqual(existsSync(folder) ? readdirSync(folder) : [], []);
  for (const module of ["run", "source", "git", "platforms", "bootstrap", "container"]) {
    assert(!existsSync(new URL(`../release/${module}.mjs`, import.meta.url)));
  }
});
