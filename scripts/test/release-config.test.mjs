import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import railway from "../../.railway/railway.ts";

test("native GitHub source waits for master CI; API alone owns migration and Neon administration", () => {
  const services = railway().resources;
  assert.deepEqual(services.map(service => service.name), ["api", "worker"]);
  for (const service of services) {
    assert.deepEqual(service.source, { type: "github", repo: "boyd4y/agrid", branch: "master", checkSuites: true });
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

test("CI covers develop and master without production secrets, release jobs or source upload machinery", () => {
  const folder = new URL("../../.github/workflows/", import.meta.url);
  assert.deepEqual(readdirSync(folder).sort(), ["checks.yml", "ci.yml"]);
  const ci = readFileSync(new URL("ci.yml", folder), "utf8");
  assert.match(ci, /push:\s+branches: \[develop, master, 'feat\/\*\*'\]/);
  assert.match(ci, /pull_request:\s+branches: \[develop, master\]/);
  for (const path of readdirSync(folder)) {
    const workflow = readFileSync(new URL(path, folder), "utf8");
    assert.doesNotMatch(workflow, /secrets\.|packages:\s*write|railway (up|deploy)|docker (push|login)|ghcr\.io/);
  }
  for (const module of ["run", "source", "git", "platforms", "bootstrap", "container"]) {
    assert(!existsSync(new URL(`../release/${module}.mjs`, import.meta.url)));
  }
});
