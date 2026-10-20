import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { prepareSource, includedSource, createUploader } from "../release/source.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "tabdo-source-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_COMMITTER_NAME: "fixture", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_EMAIL: "test@example.invalid" } }).trim();
  git(["init"]);
  const put = (path, value = path) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  for (const path of ["Dockerfile.server", ".dockerignore", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "railway.api.json", "railway.worker.json", "apps/server/src/index.ts", "apps/client/src/main.tsx", "apps/client/src/data/blog.ts", "apps/client/src/data/docs.ts", "apps/client/src/data/docs-content/en.ts", "packages/shared/src/index.ts", "scripts/release/run.mjs"]) put(path);
  // Even tracked private files and generated outputs are excluded. Real local
  // untracked/ignored files never enter the Git-object export at all.
  for (const path of [".env.production", ".herdr/private", ".railway/config.json", "apps/server/.env", "apps/server/dist/index.js", "packages/shared/node_modules/secret", "apps/server/test/private.key", "docs/internal.md"]) put(path, "private-secret");
  git(["add", "--all"]); git(["commit", "-m", "source fixture"]);
  const sha = git(["rev-parse", "HEAD"]);
  put("apps/server/src/index.ts", "uncommitted-secret");
  put("apps/server/src/untracked.ts", "untracked-secret");
  return { root, git, put, sha };
}

test("source exports pinned Git blobs only, isolates sensitive/generated files and detects drift", t => {
  const f = fixture(t);
  const source = prepareSource(f.sha, { cwd: f.root });
  t.after(source.cleanup);
  assert.equal(readFileSync(join(source.root, "apps/server/src/index.ts"), "utf8"), "apps/server/src/index.ts");
  assert(!existsSync(join(source.root, "apps/server/src/untracked.ts")));
  assert(!source.manifest.files.some(file => /private|\.env|dist\/|node_modules|\.herdr|\.railway/.test(file.path)));
  for (const path of ["apps/client/src/data/blog.ts", "apps/client/src/data/docs.ts", "apps/client/src/data/docs-content/en.ts"]) assert(existsSync(join(source.root, path)));
  source.verify();
  const second = prepareSource(f.sha, { cwd: f.root });
  try { assert.equal(source.manifestSha256, second.manifestSha256); } finally { second.cleanup(); }
  writeFileSync(join(source.root, "apps/server/src/index.ts"), "drift");
  assert.throws(source.verify, /upload_source_changed/);
});

test("source rejects symlinks and unexpected source additions, never follows a link outside export", t => {
  const f = fixture(t);
  symlinkSync("/etc/passwd", join(f.root, "apps/server/src/link"));
  f.git(["add", "apps/server/src/link"]); f.git(["commit", "-m", "link fixture"]);
  assert.throws(() => prepareSource(f.git(["rev-parse", "HEAD"]), { cwd: f.root }), /unsupported_source_entry/);
  const source = prepareSource(f.sha, { cwd: f.root });
  t.after(source.cleanup);
  writeFileSync(join(source.root, ".env"), "private");
  assert.throws(source.verify, /upload_source_changed/);
  for (const path of ["../apps/a", "apps/server/../../private", "apps/server/.env.production", "apps/server/node_modules/key", "packages/ui/dist/a", ".herdr/key"]) assert.equal(includedSource(path), false);
});

const id = "55555555-5555-5555-5555-555555555555";
test("uploader uses exact CLI JSON ID, explicit targets, pinned version and fresh token-only CLI home", async t => {
  const f = fixture(t), source = prepareSource(f.sha, { cwd: f.root });
  t.after(source.cleanup);
  let home;
  const calls = [];
  const upload = createUploader({ RUNNER_TEMP: "/runner/temp", RAILWAY_API_TOKEN: "private-project-token" }, { projectId: "project", environmentId: "production", services: ["api", "worker"] }, source, async (command, args, options) => {
    calls.push(args);
    assert.equal(command, "/runner/temp/railway-cli/node_modules/.bin/railway");
    assert.equal(options.cwd, source.root);
    home = options.env.HOME;
    assert(existsSync(home));
    assert(!existsSync(join(home, ".railway/config.json")));
    assert.deepEqual(Object.keys(options.env).sort(), ["CI", "HOME", "PATH", "RAILWAY_TOKEN"]);
    assert.equal(options.env.RAILWAY_TOKEN, "private-project-token");
    assert.equal(options.timeout, 300000);
    if (args[0] === "--version") return { stdout: "railway 5.71.0\n" };
    assert.deepEqual(args, ["up", "--project", "project", "--environment", "production", "--service", "api", "--detach", "--json", "--message", `v1.2.3 ${f.sha}`]);
    return { stdout: JSON.stringify({ deploymentId: id, logsUrl: "https://private-url" }) };
  });
  let saved;
  assert.equal(await upload("api", { version: "v1.2.3", sha: f.sha }, value => { saved = value; }), id);
  assert.equal(saved, id);
  assert.equal(calls.length, 2);
  assert(!existsSync(home));
});

test("uploader never retries uncertain upload and suppresses raw CLI errors; records ID before post-upload drift", async t => {
  const f = fixture(t);
  for (const mode of ["timeout", "invalid-json", "missing-id", "version", "drift"]) {
    const source = prepareSource(f.sha, { cwd: f.root });
    let mutations = 0, saved;
    const upload = createUploader({ RUNNER_TEMP: "/runner/temp", RAILWAY_API_TOKEN: "private" }, { projectId: "project", environmentId: "production", services: ["api"] }, source, async (_command, args) => {
      if (args[0] === "--version") return { stdout: mode === "version" ? "railway 0.0.0" : "railway 5.71.0" };
      mutations++;
      if (mode === "timeout") throw new Error("private database credential in stderr");
      if (mode === "invalid-json") return { stdout: "private-not-json" };
      if (mode === "missing-id") return { stdout: '{"status":"success"}' };
      if (mode === "drift") writeFileSync(join(source.root, "private"), "injected");
      return { stdout: JSON.stringify({ deploymentId: id }) };
    });
    try {
      await assert.rejects(() => upload("api", { version: "v1.2.3", sha: f.sha }, value => { saved = value; }), error => { assert.doesNotMatch(error.message, /private|credential/); return true; });
      assert.equal(mutations, mode === "version" ? 0 : 1);
      assert.equal(saved, mode === "drift" ? id : undefined);
    } finally { source.cleanup(); }
  }
});
