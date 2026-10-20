import assert from "node:assert/strict";
import { test } from "node:test";
import { predeployConfig, runPredeploy, migrate } from "../release/predeploy.mjs";
import { createNeon } from "../release/platforms.mjs";

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

test("Neon verifies direct endpoint and reads back snapshot operations and restore point without mutation retry", async () => {
  for (const failure of [undefined, "endpoint", "backup", "operation", "readback"]) {
    let mutations = 0, savedId;
    const json = value => new Response(JSON.stringify(value));
    const fetcher = async (url, options) => {
      assert.equal(options.headers.Authorization, "Bearer private-neon");
      assert.equal(options.redirect, "error");
      if (url.endsWith("/branches/branch")) return json({ branch: { id: "branch", project_id: "neon" } });
      if (url.endsWith("/endpoints")) return json({ endpoints: [{ branch_id: "branch", host: failure === "endpoint" ? "wrong" : new URL(databaseUrl).hostname, type: "read_write" }] });
      if (options.method === "POST") {
        mutations++;
        if (failure === "backup") throw new Error("private-neon");
        return json({ snapshot: { id: "snapshot-1" }, operations: [{ id: "op-1" }] });
      }
      if (url.includes("/operations/")) return json({ operation: { status: failure === "operation" ? "failed" : "finished" } });
      return json({ snapshots: [{ id: "snapshot-1", source_branch_id: failure === "readback" ? "wrong" : "branch", lsn: "0/1234", timestamp: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString() }] });
    };
    const ports = createNeon(env, predeployConfig(env), fetcher, { attempts: 2, intervalMs: 0 });
    const operation = async () => { await ports.verifyTarget(); return ports.snapshot("deployment-1", id => { savedId = id; }); };
    if (failure) await assert.rejects(operation);
    else { assert.equal(await operation(), "snapshot-1"); assert.equal(savedId, "snapshot-1"); }
    assert.equal(mutations, failure === "endpoint" ? 0 : 1);
  }
});
