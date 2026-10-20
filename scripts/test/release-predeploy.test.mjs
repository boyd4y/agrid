import assert from "node:assert/strict";
import { test } from "node:test";
import { predeployConfig, runPredeploy, migrate, runWorkerWait } from "../release/predeploy.mjs";
import { createNeon } from "../release/neon.mjs";

const databaseUrl = "postgresql://owner:private@ep-demo.eu-central-1.aws.neon.tech/db?sslmode=require";
const env = {
  NODE_ENV: "production", TABDO_ENV: "production", RAILWAY_DEPLOYMENT_ID: "deployment-1",
  RELEASE_RAILWAY_PROJECT_ID: "project", RAILWAY_PROJECT_ID: "project",
  RELEASE_RAILWAY_ENVIRONMENT_ID: "production", RAILWAY_ENVIRONMENT_ID: "production",
  RELEASE_RAILWAY_API_SERVICE_ID: "api", RAILWAY_SERVICE_ID: "api",
  NEON_PROJECT_ID: "neon", NEON_BRANCH_ID: "branch", NEON_API_KEY: "private-neon",
  DATABASE_URL: databaseUrl.replace("ep-demo.", "ep-demo-pooler."), DATABASE_URL_UNPOOLED: databaseUrl,
};

test("predeploy requires exact production API and direct database, forbids orphan repair options", () => {
  assert.equal(predeployConfig(env).databaseUrl, databaseUrl);
  for (const override of [{ RAILWAY_SERVICE_ID: "worker" }, { RAILWAY_PROJECT_ID: "other" }, { RAILWAY_ENVIRONMENT_ID: "test" }, { NODE_ENV: "test" }, { RAILWAY_DEPLOYMENT_ID: "" }, { NEON_API_KEY: "" }, { NEON_PROJECT_ID: undefined }, { NEON_BRANCH_ID: undefined }, { DATABASE_URL: databaseUrl.replace("/db?", "/other?") }, { DATABASE_URL_UNPOOLED: env.DATABASE_URL }, { MIGRATION_ORPHAN_ORG_ID: "org" }, { MIGRATION_ALLOW_ORPHAN_DELETE: "true" }]) {
    assert.throws(() => predeployConfig({ ...env, ...override }));
  }
});

function fixture({ pending = ["0034_safe"], fail, readback = [] } = {}) {
  const calls = [], saved = [];
  let plans = 0;
  const call = (name, value) => async (...args) => {
    calls.push(name);
    if (fail === name) throw new Error("private-neon postgresql://private");
    return typeof value === "function" ? value(...args) : value;
  };
  const ports = {
    verifyTarget: call("target"), migrationPlan: call("plan", () => plans++ ? readback : pending),
    snapshot: call("snapshot", (_name, save) => { save("snapshot-1"); return "snapshot-1"; }), migrate: call("migrate"),
  };
  return { calls, saved, run: () => runPredeploy({ env, ports, save: value => saved.push(JSON.stringify(value)) }) };
}

test("pending migrations require verified backup before one migration and ledger readback", async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.status, "success");
  assert.equal(result.backupId, "snapshot-1");
  assert.deepEqual(f.calls, ["target", "plan", "snapshot", "migrate", "plan"]);
});

test("no pending migrations skips snapshot and migrator", async () => {
  const f = fixture({ pending: [] });
  assert.equal((await f.run()).status, "success");
  assert.deepEqual(f.calls, ["target", "plan"]);
});

test("worker waits read-only for API ledger without any Neon management configuration", async () => {
  const workerEnv = { NODE_ENV: "production", TABDO_ENV: "production", RAILWAY_DEPLOYMENT_ID: "worker-deployment", DATABASE_URL: env.DATABASE_URL, DATABASE_URL_UNPOOLED: databaseUrl };
  for (const pending of [[], [["0034_safe"], ["0034_safe"], []]]) {
    const values = pending.length ? pending : [[]];
    let reads = 0;
    const result = await runWorkerWait({ env: workerEnv, migrationPlan: async url => {
      assert.equal(url, databaseUrl);
      return values[reads++];
    }, pollOptions: { attempts: 3, intervalMs: 0 } });
    assert.equal(result.status, "success");
    assert.equal(reads, values.length);
  }
});

test("worker fails closed on pending timeout, database errors or nonproduction configuration", async () => {
  for (const mode of ["pending", "database", "environment"]) {
    let reads = 0;
    const result = await runWorkerWait({ env: { ...env, ...(mode === "environment" ? { NODE_ENV: "development" } : {}) }, migrationPlan: async () => {
      reads++;
      if (mode === "database") throw new Error("private connection secret");
      return ["0034_safe"];
    }, pollOptions: { attempts: 2, intervalMs: 0 } });
    assert.equal(result.status, "failed");
    assert.doesNotMatch(JSON.stringify(result), /private|connection|secret/);
    assert.equal(reads, mode === "pending" ? 2 : mode === "database" ? 1 : 0);
  }
});

test("target, plan and backup failures block migration, all failures remain sanitized", async () => {
  for (const fail of ["target", "plan", "snapshot", "migrate"]) {
    const f = fixture({ fail });
    assert.equal((await f.run()).status, "failed");
    if (fail !== "migrate") assert(!f.calls.includes("migrate"));
    assert.doesNotMatch(f.saved.join(""), /private|postgresql:/);
  }
  assert.equal((await fixture({ readback: ["0034_safe"] }).run()).error, "migration_readback_incomplete");
});

test("built migrator runs once with bounded lifetime and no management credentials or raw output", async () => {
  for (const fail of [false, true]) {
    let calls = 0;
    const run = async (command, args, options) => {
      calls++;
      assert.equal(command, process.execPath);
      assert.match(args[0], /apps\/server\/dist\/db\/migrate.js$/);
      assert(!args.join(" ").includes("private"));
      assert.equal(options.env.DATABASE_URL_UNPOOLED, databaseUrl);
      assert.equal(options.env.NEON_API_KEY, undefined);
      assert.equal(options.env.MIGRATION_ALLOW_ORPHAN_DELETE, undefined);
      assert.equal(options.timeout, 300000);
      assert.equal(options.killSignal, "SIGKILL");
      if (fail) throw new Error("private connection");
    };
    if (fail) await assert.rejects(() => migrate(databaseUrl, run), /migration_failed_or_timed_out_outcome_unknown/);
    else await migrate(databaseUrl, run);
    assert.equal(calls, 1);
  }
});

test("Neon verifies snapshot identity and dates without optional restore fields or mutation retry", async t => {
  const readbackFailures = {
    id: { id: "snapshot-other" },
    branch: { source_branch_id: "wrong" },
    name: { name: "tabdo-another-deployment" },
    missingName: { name: undefined },
    missingCreatedAt: { created_at: undefined },
    nullCreatedAt: { created_at: null },
    numericCreatedAt: { created_at: 1 },
    invalidCreatedAt: { created_at: "not-a-date" },
    missingExpiry: { expires_at: undefined },
    invalidExpiry: { expires_at: "not-a-date" },
    expired: { expires_at: "2000-01-01T00:00:00Z" },
  };
  for (const failure of [undefined, "endpoint", "backup", "operation", ...Object.keys(readbackFailures)]) await t.test(failure ?? "valid snapshot without lsn or timestamp", async () => {
    let mutations = 0, migrations = 0, operationReads = 0, snapshotReads = 0, savedId, snapshotName;
    const json = value => new Response(JSON.stringify(value));
    const fetcher = async (url, options) => {
      assert.equal(options.headers.Authorization, "Bearer private-neon");
      assert.equal(options.redirect, "error");
      if (url.endsWith("/branches/branch")) return json({ branch: { id: "branch", project_id: "neon" } });
      if (url.endsWith("/endpoints")) return json({ endpoints: [{ branch_id: "branch", host: failure === "endpoint" ? "wrong" : new URL(databaseUrl).hostname, type: "read_write" }] });
      if (options.method === "POST") {
        mutations++;
        snapshotName = new URL(url).searchParams.get("name");
        assert.match(snapshotName, /^tabdo-deployment-1-\d+$/);
        if (failure === "backup") throw new Error("private-neon");
        return json({ snapshot: { id: "snapshot-1" }, operations: [{ id: "op-1" }] });
      }
      if (url.includes("/operations/")) return json({ operation: { status: failure === "operation" ? "failed" : ++operationReads === 1 ? "running" : "finished" } });
      assert.equal(new URL(url).pathname, "/api/v2/projects/neon/snapshots");
      assert.equal(operationReads, 2);
      if (++snapshotReads === 1) return json({ snapshots: [] });
      return json({ snapshots: [{
        id: "snapshot-1", name: snapshotName, source_branch_id: "branch",
        created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(),
        manual: true, full_size: 1234, ...readbackFailures[failure],
      }] });
    };
    const ports = createNeon(env, predeployConfig(env), fetcher, { attempts: 2, intervalMs: 0 });
    const result = await runPredeploy({ env, ports: {
      ...ports,
      snapshot: (deploymentId, save) => ports.snapshot(deploymentId, id => { savedId = id; save(id); }),
      migrationPlan: async () => migrations ? [] : ["0034_safe"],
      migrate: async () => { migrations++; },
    } });
    assert.equal(result.status, failure ? "failed" : "success");
    assert.equal(migrations, failure ? 0 : 1);
    if (readbackFailures[failure]) assert.equal(result.error, failure === "id" ? "platform_wait_timeout_outcome_unknown" : "snapshot_readback_mismatch");
    if (!failure) {
      assert.equal(result.backupId, "snapshot-1");
      assert.equal(savedId, "snapshot-1");
      assert.equal(snapshotReads, 2);
    }
    assert.equal(mutations, failure === "endpoint" ? 0 : 1);
  });
});
