import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseEvent, productionConfig, ReleaseError, checkRuntimeVariables } from "../release/guards.mjs";
import { verifyGit } from "../release/git.mjs";
import { pendingMigrations } from "../release/database.mjs";
import { runRelease } from "../release/run.mjs";

const sha = "a".repeat(40);
const databaseUrl = "postgresql://owner:very-private@ep-demo.eu-central-1.aws.neon.tech/db?sslmode=require";
const env = {
  GITHUB_EVENT_NAME: "push", GITHUB_REF_TYPE: "tag", GITHUB_REF: "refs/tags/v1.2.3", GITHUB_SHA: sha, GITHUB_REPOSITORY: "boyd4y/agrid",
  RELEASE_ENVIRONMENT: "tabdo / production", RELEASE_BOOTSTRAP_READY: "true", RELEASE_TAG_OID: sha,
  RAILWAY_API_TOKEN: "secret-railway", NEON_API_KEY: "secret-neon", RELEASE_DATABASE_URL: databaseUrl,
  RAILWAY_PROJECT_ID: "11111111-1111-1111-1111-111111111111", RAILWAY_ENVIRONMENT_ID: "22222222-2222-2222-2222-222222222222", RAILWAY_API_SERVICE_ID: "33333333-3333-3333-3333-333333333333", RAILWAY_WORKER_SERVICE_ID: "44444444-4444-4444-4444-444444444444",
  NEON_PROJECT_ID: "neon", NEON_BRANCH_ID: "branch", RELEASE_PUBLIC_URL: "https://tabdo.example",
};
const event = { created: true, forced: false, deleted: false, after: sha };

test("release accepts only new stable semver tags from this repository", () => {
  assert.equal(releaseEvent(event, env).version, "v1.2.3");
  for (const value of ["v01.2.3", "v1.2", "v1.2.3-rc.1", "v1.2.3+foo", "master", "v1.2.3\n"]) {
    assert.throws(() => releaseEvent(event, { ...env, GITHUB_REF: `refs/tags/${value}` }));
  }
  for (const override of [{ GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_REF_TYPE: "branch" }, { GITHUB_REPOSITORY: "someone/else" }]) assert.throws(() => releaseEvent(event, { ...env, ...override }));
  for (const override of [{ created: false }, { forced: true }, { deleted: true }]) assert.throws(() => releaseEvent({ ...event, ...override }, env));
});

test("git verification rejects tag rebinding, checkout drift and commits off master; supports annotated tags", () => {
  const release = releaseEvent(event, env);
  const run = args => args[0] === "ls-remote" ? `${sha}\trefs/tags/v1.2.3` : args[0] === "rev-parse" ? sha : "";
  verifyGit(release, run);
  assert.throws(() => verifyGit(release, args => args[0] === "ls-remote" ? `${"c".repeat(40)}\trefs/tags/v1.2.3` : run(args)), /tag_rebound/);
  assert.throws(() => verifyGit(release, args => args[0] === "rev-parse" && args[1] === "HEAD" ? "c".repeat(40) : run(args)), /checkout_sha/);
  assert.throws(() => verifyGit(release, args => { if (args[0] === "merge-base") throw new Error("not ancestor"); return run(args); }), /commit_not_on_master/);
  const oid = "d".repeat(40);
  verifyGit({ ...release, tagOid: oid }, args => args[0] === "ls-remote" ? `${oid}\trefs/tags/v1.2.3\n${sha}\trefs/tags/v1.2.3^{}` : run(args));
  const annotated = args => args[0] === "ls-remote" ? `${oid}\trefs/tags/v1.2.3\n${sha}\trefs/tags/v1.2.3^{}` : run(args);
  assert.equal(verifyGit(release, annotated, { allowPeeledEvent: true }).tagOid, oid);
  for (const eventOid of [sha, oid]) {
    for (const after of [sha, oid]) {
      const input = releaseEvent({ ...event, after }, { ...env, GITHUB_SHA: eventOid });
      const authorized = verifyGit(input, annotated, { allowPeeledEvent: true });
      assert.equal(authorized.sha, sha);
      assert.equal(authorized.tagOid, oid);
      assert.deepEqual(verifyGit({ ...input, tagOid: authorized.tagOid }, annotated), authorized);
    }
  }
  assert.throws(() => verifyGit(release, annotated), /tag_rebound/, "production rejects even a rebind to the same commit");
});

test("production fails closed on missing configuration, wrong environment, targets or runtime variables", () => {
  const config = productionConfig(env);
  for (const key of ["RAILWAY_API_TOKEN", "RAILWAY_PROJECT_ID", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_API_SERVICE_ID", "RAILWAY_WORKER_SERVICE_ID", "RELEASE_PUBLIC_URL"]) assert.throws(() => productionConfig({ ...env, [key]: "" }), new RegExp(`missing_${key}`));
  for (const override of [{ RELEASE_BOOTSTRAP_READY: "false" }, { RELEASE_ENVIRONMENT: "development" }, { RELEASE_PUBLIC_URL: "http://tabdo.example" }, { RAILWAY_API_SERVICE_ID: "worker" }]) assert.throws(() => productionConfig({ ...env, ...override }));
  const values = { NODE_ENV: "production", TABDO_ENV: "production", AUTH_REQUIRED: "true", QUEUE_PREFIX: "tabdo-production", DATABASE_URL: databaseUrl.replace("ep-demo.", "ep-demo-pooler."), DATABASE_URL_UNPOOLED: databaseUrl, APP_URL: config.publicUrl, BETTER_AUTH_URL: config.publicUrl };
  checkRuntimeVariables(values, { ...config, databaseUrl });
  for (const override of [{ TABDO_ENV: "development" }, { DATABASE_URL: databaseUrl.replace("/db?", "/other?") }, { DATABASE_URL_UNPOOLED: undefined }, { APP_URL: "https://other.example" }, { QUEUE_PREFIX: "test" }]) assert.throws(() => checkRuntimeVariables({ ...values, ...override }, { ...config, databaseUrl }));
});

test("migration plans accept migrator aliases, require explicit hash-bound compatibility, and reject gaps/unknown ledger", () => {
  const entries = [
    { idx: 0, tag: "0000_initial", when: 10, hash: "hash0" },
    { idx: 2, tag: "0002_perf", when: 20, hash: "hash2" },
    { idx: 6, tag: "0006_safe", when: 30, hash: "hash6" },
  ];
  for (const ledger of [
    entries.map(e => ({ hash: e.hash, created_at: 999 })),
    entries.map(e => ({ hash: e.tag, created_at: 999 })),
    entries.map(e => ({ hash: "legacy", created_at: e.when })),
    [{ hash: "0000_initial", created_at: 10 }, { hash: "old-hash", created_at: 1760160000000 }, { hash: "hash6", created_at: 30 }],
  ]) assert.deepEqual(pendingMigrations(entries, ledger, {}), []);
  const ledger = entries.slice(0, 2).map(e => ({ hash: e.hash, created_at: e.when }));
  assert.throws(() => pendingMigrations(entries, ledger, {}), /separate_compatibility/);
  const approval = { "0006_safe": { sha256: "hash6", compatibility: "backward-compatible", requiresWriterDrain: false } };
  assert.deepEqual(pendingMigrations(entries, ledger, approval), ["0006_safe"]);
  assert.throws(() => pendingMigrations(entries, ledger, { "0006_safe": { ...approval["0006_safe"], sha256: "modified" } }));
  assert.throws(() => pendingMigrations(entries, ledger, { "0006_safe": { ...approval["0006_safe"], requiresWriterDrain: true } }));
  assert.throws(() => pendingMigrations(entries, [...ledger, { hash: "unknown", created_at: 999 }] , approval), /unknown_migration_ledger/);
  assert.throws(() => pendingMigrations(entries, [{ hash: "hash6" }], approval), /ledger_gap/);
});

function fixture({ fail } = {}) {
  const calls = [], saved = [];
  const call = (name, value) => async (...args) => {
    calls.push([name, ...args]);
    if (name === fail) throw new Error(`private ${databaseUrl} ${env.RAILWAY_API_TOKEN}`);
    return typeof value === "function" ? value(...args) : value;
  };
  const ports = {
    verifyGit: call("git", release => release),
    prepareSource: call("source", sha => ({ sha, manifestSha256: "b".repeat(64), fileCount: 2 })),
    preflight: call("preflight", []), deploy: call("deploy", id => `new-${id}`), wait: call("wait"), smoke: call("smoke"),
  };
  return { calls, saved, ports, execute: overrides => runRelease({ env: { ...env, ...overrides }, event, ports, save: value => saved.push(JSON.stringify(value)) }) };
}

test("release pins one source manifest and serializes API health before worker with exact IDs", async () => {
  const f = fixture();
  const result = await f.execute();
  assert.equal(result.status, "success");
  assert.deepEqual(f.calls.map(c => c[0]), ["git", "source", "preflight", "smoke", "git", "deploy", "wait", "smoke", "git", "deploy", "wait", "wait", "wait", "smoke", "git"]);
  const uploads = f.calls.filter(c => c[0] === "deploy");
  assert.deepEqual(uploads.map(c => c[1]), [env.RAILWAY_API_SERVICE_ID, env.RAILWAY_WORKER_SERVICE_ID]);
  assert.equal(uploads[0][2].sha, sha);
  assert.deepEqual(uploads[0][2], uploads[1][2]);
  assert(result.deployments.every(d => d.manifestSha256 === result.source.manifestSha256));
});

for (const failure of ["git", "source", "preflight", "deploy", "wait", "smoke"]) {
  test(`${failure} failure stops later stages and preserves sanitized evidence`, async () => {
    const f = fixture({ fail: failure });
    const result = await f.execute();
    assert.notEqual(result.status, "success");
    const calls = f.calls.map(c => c[0]);
    if (["git", "source", "preflight", "smoke"].includes(failure)) assert(!calls.includes("deploy"));
    if (failure === "wait") { assert.equal(calls.filter(c => c === "deploy").length, 1); assert.equal(result.deployments.length, 1); }
    assert.doesNotMatch(f.saved.join(""), /very-private|secret-railway|secret-neon|postgresql:/);
    if (["deploy", "wait"].includes(failure)) assert.equal(result.status, "manual_recovery_required");
  });
}

test("bootstrap, raw tag pin and missing credentials fail before platform operations", async () => {
  for (const override of [{ RELEASE_BOOTSTRAP_READY: "" }, { RELEASE_TAG_OID: "" }, { RAILWAY_API_TOKEN: "" }]) {
    const f = fixture();
    assert.notEqual((await f.execute(override)).status, "success");
    assert.equal(f.calls.length, 0);
  }
});

test("late failures preserve exact uploaded ID and never report success", async () => {
  for (const failure of ["second-deploy", "final-api", "final-tag", "deployed-health", "post-upload"]) {
    const f = fixture();
    if (failure === "second-deploy") f.ports.deploy = async id => { if (id === env.RAILWAY_WORKER_SERVICE_ID) throw new ReleaseError("worker_failed"); return "new-api"; };
    if (failure === "post-upload") f.ports.deploy = async (_id, _release, save) => { save("new-api"); throw new ReleaseError("upload_source_changed"); };
    if (failure === "final-api") { let waits = 0; f.ports.wait = async () => { if (++waits === 3) throw new ReleaseError("late_api_failure"); }; }
    if (failure === "final-tag") { let checks = 0; f.ports.verifyGit = async release => { if (++checks === 4) throw new ReleaseError("tag_rebound"); return release; }; }
    if (failure === "deployed-health") { let smokes = 0; f.ports.smoke = async () => { if (++smokes === 2) throw new ReleaseError("health_schema_failed"); }; }
    const result = await f.execute();
    assert.equal(result.status, "manual_recovery_required");
    if (["deployed-health", "post-upload"].includes(failure)) assert.equal(result.deployments.length, 1);
  }
});

test("isolated Git origin accepts raw/peeled annotated events through authorize CLI and production, retaining both pins", async t => {
  const directory = mkdtempSync(join(tmpdir(), "tabdo-release-git-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const work = join(directory, "work"), origin = join(directory, "origin.git");
  mkdirSync(work);
  const gitEnv = {
    PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Release fixture", GIT_AUTHOR_EMAIL: "release@example.invalid",
    GIT_COMMITTER_NAME: "Release fixture", GIT_COMMITTER_EMAIL: "release@example.invalid",
  };
  const git = args => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", "-c", "tag.gpgSign=false", ...args], { cwd: work, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }).trim();
  git(["init", "--bare", origin]);
  git(["init", "-b", "master"]);
  writeFileSync(join(work, "fixture.txt"), "isolated release fixture\n");
  git(["add", "fixture.txt"]); git(["commit", "-m", "fixture"]);
  git(["remote", "add", "origin", origin]); git(["push", "origin", "master"]);
  const commit = git(["rev-parse", "HEAD"]);
  git(["tag", "-a", "v1.2.3", "-m", "annotated fixture"]);
  git(["tag", "v1.2.4"]);
  git(["push", "origin", "refs/tags/v1.2.3", "refs/tags/v1.2.4"]);
  const annotatedOid = git(["rev-parse", "refs/tags/v1.2.3"]);
  assert.notEqual(annotatedOid, commit);
  const script = fileURLToPath(new URL("../release/git.mjs", import.meta.url));
  for (const version of ["v1.2.3", "v1.2.4"]) {
    const raw = git(["rev-parse", `refs/tags/${version}`]);
    git(["checkout", "--detach", `refs/tags/${version}`]);
    assert.equal(git(["rev-parse", "HEAD"]), commit);
    for (const eventOid of new Set([commit, raw])) {
      for (const after of new Set([commit, raw])) {
        const payload = { ...event, after };
        const inputs = { ...env, GITHUB_REF: `refs/tags/${version}`, GITHUB_SHA: eventOid };
        const eventPath = join(directory, "event.json"), outputPath = join(directory, "output.txt");
        writeFileSync(eventPath, JSON.stringify(payload)); writeFileSync(outputPath, "");
        // Execute the actual authorize entry point with no platform credentials.
        const stdout = execFileSync(process.execPath, [script], { cwd: work, env: {
          ...gitEnv, GITHUB_EVENT_NAME: inputs.GITHUB_EVENT_NAME, GITHUB_REF_TYPE: inputs.GITHUB_REF_TYPE,
          GITHUB_REF: inputs.GITHUB_REF, GITHUB_SHA: eventOid, GITHUB_REPOSITORY: inputs.GITHUB_REPOSITORY,
          GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath,
        }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
        const authorized = JSON.parse(stdout);
        assert.deepEqual(authorized, { version, sha: commit, tagOid: raw });
        assert.match(readFileSync(outputPath, "utf8"), new RegExp(`sha=${commit}\\n`));
        const f = fixture({ pending: [] });
        f.ports.verifyGit = release => verifyGit(release, git);
        const result = await runRelease({ env: { ...inputs, RELEASE_TAG_OID: authorized.tagOid }, event: payload, ports: f.ports });
        assert.equal(result.status, "success");
        assert.equal(result.sha, commit);
        assert.equal(result.tagOid, raw);
        assert.equal(f.calls.find(call => call[0] === "source")[1], commit, "source export uses the commit, never the tag object");
      }
    }
  }
  const input = { version: "v1.2.3", sha: annotatedOid, tagOid: annotatedOid };
  assert.throws(() => verifyGit({ ...input, tagOid: "c".repeat(40) }, git), /tag_rebound/);
  git(["commit", "--allow-empty", "-m", "unreviewed detached fixture"]);
  const offMaster = git(["rev-parse", "HEAD"]);
  assert.throws(() => verifyGit(input, git), /checkout_sha_mismatch/);
  git(["tag", "v1.2.5"]); git(["push", "origin", "refs/tags/v1.2.5"]);
  assert.throws(() => verifyGit({ version: "v1.2.5", sha: offMaster, tagOid: offMaster }, git), /commit_not_on_master/);
  git(["checkout", "--detach", commit]);
  git(["tag", "-f", "-a", "v1.2.3", "-m", "rebound fixture"]);
  git(["push", "--force", "origin", "refs/tags/v1.2.3"]);
  assert.throws(() => verifyGit({ ...input, sha: commit }, git), /tag_rebound/, "production still rejects raw tag rebinding to the same commit");
});
