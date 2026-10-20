import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bootstrapConfig, prepareSource, verifySource, requireAbsentTag, pushedDigest } from "../release/bootstrap.mjs";

const sha = "a".repeat(40);
const env = {
  GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/master", GITHUB_REPOSITORY: "boyd4y/agrid",
  GITHUB_WORKFLOW_REF: "boyd4y/agrid/.github/workflows/ghcr-bootstrap.yml@refs/heads/master",
  BOOTSTRAP_SHA: sha, GITHUB_SHA: sha, RUNNER_TEMP: "/tmp/bootstrap-fixture",
  PACKAGE_TOKEN: "private-package-token", GITHUB_ACTOR: "fixture-user",
};

test("bootstrap accepts only full commit SHAs dispatched with the master workflow in this repository", () => {
  assert.equal(bootstrapConfig(env).image, `ghcr.io/boyd4y/agrid:bootstrap-sha-${sha}`);
  for (const override of [
    { GITHUB_EVENT_NAME: "push" }, { GITHUB_REF: "refs/heads/feature" }, { GITHUB_REF: "refs/tags/v1.2.3" },
    { GITHUB_REPOSITORY: "someone/else" }, { GITHUB_WORKFLOW_REF: env.GITHUB_WORKFLOW_REF.replace("master", "feature") },
    { BOOTSTRAP_SHA: "master" }, { BOOTSTRAP_SHA: sha.slice(0, 7) }, { BOOTSTRAP_SHA: `${sha}\n` },
    { BOOTSTRAP_SHA: "$(touch /tmp/not-a-sha)" }, { GITHUB_SHA: "" }, { RUNNER_TEMP: "" },
  ]) assert.throws(() => bootstrapConfig({ ...env, ...override }));
});

test("isolated Git origin prepares an older master commit and rejects off-master, tag-object and dirty source", t => {
  const root = mkdtempSync(join(tmpdir(), "tabdo-bootstrap-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const work = join(root, "work"), origin = join(root, "origin.git");
  mkdirSync(work);
  const gitEnv = {
    PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Bootstrap fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Bootstrap fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
  const execute = (command, args) => execFileSync(command, ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", "-c", "tag.gpgSign=false", ...args], {
    cwd: work, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000,
  }).trim();
  const git = args => execute("git", args);
  git(["init", "--bare", origin]); git(["init", "-b", "master"]);
  writeFileSync(join(work, ".gitignore"), "private.env\n");
  writeFileSync(join(work, "fixture.txt"), "reviewed source\n");
  git(["add", "."]); git(["commit", "-m", "reviewed fixture"]);
  const sourceSha = git(["rev-parse", "HEAD"]);
  git(["commit", "--allow-empty", "-m", "newer trusted workflow fixture"]);
  const workflowSha = git(["rev-parse", "HEAD"]);
  git(["remote", "add", "origin", origin]); git(["push", "origin", "master"]);
  git(["tag", "-a", "annotated", "-m", "tag fixture"]);
  const tagOid = git(["rev-parse", "refs/tags/annotated"]);
  git(["checkout", "--detach"]); git(["commit", "--allow-empty", "-m", "unreviewed fixture"]);
  const offMaster = git(["rev-parse", "HEAD"]);
  git(["checkout", "master"]);
  const config = bootstrapConfig({ ...env, BOOTSTRAP_SHA: sourceSha, GITHUB_SHA: workflowSha, RUNNER_TEMP: root });
  assert.throws(() => prepareSource({ ...config, sha: offMaster }, execute));
  assert.throws(() => prepareSource({ ...config, sha: tagOid }, execute), /input_not_commit/);
  assert.throws(() => prepareSource({ ...config, workflowSha: sourceSha }, execute), /workflow_sha_mismatch/);
  writeFileSync(join(work, "untracked.txt"), "dirty trusted checkout");
  assert.throws(() => prepareSource(config, execute), /workflow_not_clean/);
  rmSync(join(work, "untracked.txt"));
  prepareSource(config, execute);
  assert.equal(git(["-C", config.source, "rev-parse", "HEAD"]), sourceSha);
  assert.equal(git(["rev-parse", "HEAD"]), workflowSha, "guards stay at the dispatched workflow commit");
  verifySource(config, execute);
  assert.throws(() => verifySource({ ...config, sha: workflowSha }, execute), /checkout_sha_mismatch/);
  for (const filename of ["fixture.txt", "untracked.txt", "private.env"]) {
    writeFileSync(join(config.source, filename), "dirty build source");
    assert.throws(() => verifySource(config, execute), /source_not_clean/);
    if (filename === "fixture.txt") git(["-C", config.source, "checkout", "--", filename]);
    else rmSync(join(config.source, filename));
  }
});

test("registry checks allow only explicit absence and refuse existing tags, auth errors and ambiguous failures", async () => {
  const config = bootstrapConfig(env);
  const check = (status, body) => requireAbsentTag(config, env, async (url, options) => {
    assert.equal(options.redirect, "error");
    assert(options.signal);
    if (url.startsWith("https://ghcr.io/token?")) {
      assert(url.endsWith("scope=repository:boyd4y/agrid:pull,push"));
      assert.equal(options.headers.Authorization, `Basic ${Buffer.from(`${env.GITHUB_ACTOR}:${env.PACKAGE_TOKEN}`).toString("base64")}`);
      return new Response(JSON.stringify({ token: "scoped-registry-token" }));
    }
    assert.equal(url, `https://ghcr.io/v2/boyd4y/agrid/manifests/bootstrap-sha-${sha}`);
    assert.equal(options.headers.Authorization, "Bearer scoped-registry-token");
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  });
  for (const code of ["NAME_UNKNOWN", "MANIFEST_UNKNOWN"]) await check(404, { errors: [{ code }] });
  await assert.rejects(check(200, {}), /already_exists_refusing_overwrite/);
  for (const status of [401, 403, 429, 500]) await assert.rejects(check(status, {}), /absence_not_confirmed/);
  for (const body of [{}, { errors: [] }, { errors: [{ code: "DENIED" }] }, { errors: [{ code: "MANIFEST_UNKNOWN" }, { code: "UNAUTHORIZED" }] }, "not json"]) {
    await assert.rejects(check(404, body));
  }
  for (const response of [new Response("denied", { status: 403 }), new Response("{}")]) {
    await assert.rejects(requireAbsentTag(config, env, async () => response), /registry_auth_failed|registry_token_missing/);
  }
  await assert.rejects(requireAbsentTag(config, { ...env, PACKAGE_TOKEN: "" }), /credentials_missing/);
  await assert.rejects(requireAbsentTag(config, env, async () => { throw new Error("timeout"); }), /timeout/);
});

test("digest output requires the pushed repository digest, exact source labels and linux/amd64 image", () => {
  const config = bootstrapConfig(env), digest = `sha256:${"b".repeat(64)}`;
  const image = { Os: "linux", Architecture: "amd64", Config: { Labels: {
    "org.opencontainers.image.revision": sha, "org.opencontainers.image.source": "https://github.com/boyd4y/agrid",
  } }, RepoDigests: [`ghcr.io/boyd4y/agrid@${digest}`] };
  assert.equal(pushedDigest(config, () => JSON.stringify([image])), digest);
  for (const override of [{ Os: "windows" }, { Architecture: "arm64" }, { Config: { Labels: {} } }, { RepoDigests: [] }, { RepoDigests: ["other/image@" + digest] }, { RepoDigests: ["ghcr.io/boyd4y/agrid@latest"] }]) {
    assert.throws(() => pushedDigest(config, () => JSON.stringify([{ ...image, ...override }])));
  }
});

test("workflow confines dispatch, credentials, source, tag and push order without production access", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/ghcr-bootstrap.yml", import.meta.url), "utf8");
  assert.match(workflow, /on:\n  workflow_dispatch:/);
  assert.match(workflow, /github.ref == 'refs\/heads\/master'/);
  assert.match(workflow, /group: tabdo-ghcr-bootstrap\n  cancel-in-progress: false/);
  assert.match(workflow, /packages: write/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /--platform linux\/amd64 --provenance=false/);
  assert.match(workflow, /--load --file "\$SOURCE_DIR\/Dockerfile.server" "\$SOURCE_DIR"/);
  const commands = [...workflow.matchAll(/run: (node scripts\/release\/bootstrap.mjs \w+|docker push "\$IMAGE")/g)].map(match => match[1]);
  assert.deepEqual(commands, ["node scripts/release/bootstrap.mjs prepare", "node scripts/release/bootstrap.mjs check", "node scripts/release/bootstrap.mjs check", 'docker push "$IMAGE"', "node scripts/release/bootstrap.mjs result"]);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /docker logout ghcr.io/);
  assert.doesNotMatch(workflow, /environment:|secrets\.|RAILWAY|NEON|RELEASE_DATABASE|--push|pull_request:|\n  push:/);
  for (const match of workflow.matchAll(/uses: (\S+)/g)) assert.match(match[1], /@[a-f0-9]{40}$/);
});
