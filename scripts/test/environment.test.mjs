import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { loadEnvironment } from "../environment.mjs";

function fixture(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "tabdo-env-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) writeFileSync(join(root, file), content);
  return root;
}

test("development reads only its own file, ignoring legacy and production credentials", t => {
  const root = fixture(t, {
    ".env": "DATABASE_URL=postgresql://secret:password@neon.example/prod",
    ".env.local": "REDIS_URL=redis://production.example:6379",
    ".env.production": "DATABASE_URL=postgresql://production.example/prod",
    ".env.development": "DATABASE_URL=postgresql://127.0.0.1:5432/dev\nQUEUE_PREFIX=dev-only",
  });
  const env = {};
  loadEnvironment({ root, env });
  assert.equal(env.DATABASE_URL, "postgresql://127.0.0.1:5432/dev");
  assert.equal(env.REDIS_URL, "redis://127.0.0.1:6380");
  assert.equal(env.QUEUE_PREFIX, "dev-only");
  assert.equal(env.TABDO_ENV, "development");
});

test("no scoped file falls back to local services, never legacy .env", t => {
  const root = fixture(t, { ".env": "DATABASE_URL=postgresql://neon.example/prod" });
  const env = {};
  loadEnvironment({ root, env });
  assert.equal(new URL(env.DATABASE_URL).hostname, "127.0.0.1");
});

for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "REDIS_URL", "QUEUE_DATABASE_URL", "QUEUE_REDIS_URL", "APP_URL", "BETTER_AUTH_URL", "TABDO_API_TARGET", "TABDO_API_URL", "TABLE_API_URL"]) {
  test(`development rejects a remote ${key} from either file or shell without revealing credentials`, t => {
    const remote = key.includes("DATABASE") ? "postgresql://private:password@neon.example/prod" : "https://private:password@remote.example";
    const root = fixture(t, { ".env.development": `${key}=${remote}` });
    for (const env of [{}, { [key]: remote }]) {
      assert.throws(() => loadEnvironment({ root, env }), error => {
        assert.match(error.message, new RegExp(key));
        assert.doesNotMatch(error.message, /private|password|neon\.example/);
        return true;
      });
      assert.equal(env.TABDO_ENV, undefined, "invalid environment must not be applied");
    }
  });
}

test("development rejects remote storage", t => {
  assert.throws(() => loadEnvironment({ root: fixture(t), env: { FILE_STORAGE_DRIVER: "s3" } }), /FILE_STORAGE_DRIVER=local/);
});

test("production accepts remote services and injected Railway variables take precedence", t => {
  const root = fixture(t, {
    ".env.development": "DATABASE_URL=postgresql://localhost/dev",
    ".env.production": "DATABASE_URL=postgresql://file.example/prod\nQUEUE_PREFIX=prod-only",
  });
  const env = { NODE_ENV: "production", DATABASE_URL: "postgresql://injected.example/prod", FILE_STORAGE_DRIVER: "s3" };
  loadEnvironment({ root, env });
  assert.equal(env.DATABASE_URL, "postgresql://injected.example/prod");
  assert.equal(env.QUEUE_PREFIX, "prod-only");
  assert.equal(env.FILE_STORAGE_DRIVER, "s3");
});

test("test mode never loads developer or production values, preserving isolated test databases", t => {
  const root = fixture(t, {
    ".env.development": "DATABASE_URL=postgresql://localhost/user-data\nDATABASE_URL_UNPOOLED=postgresql://localhost/user-data",
    ".env.production": "DATABASE_URL=postgresql://neon.example/prod",
  });
  const env = { NODE_ENV: "test", DATABASE_URL: "postgresql://localhost/tabdo_agent_test", REDIS_URL: "redis://localhost:6381" };
  loadEnvironment({ root, env });
  assert.equal(env.DATABASE_URL, "postgresql://localhost/tabdo_agent_test");
  assert.equal(env.DATABASE_URL_UNPOOLED, undefined);
  assert.equal(env.REDIS_URL, "redis://localhost:6381");
});

test("files cannot change their selected environment", t => {
  const root = fixture(t, { ".env.development": "TABDO_ENV=production\nNODE_ENV=production\nDATABASE_URL=postgresql://neon.example/prod" });
  assert.throws(() => loadEnvironment({ root, env: {}, mode: "development" }), /local DATABASE_URL/);
});

test("explicit development launcher overrides production mode and refuses remote shell URLs before spawning", () => {
  const env = { ...process.env, NODE_ENV: "production", TABDO_ENV: "production", DATABASE_URL: "postgresql://private:password@neon.example/prod" };
  const result = spawnSync(process.execPath, ["scripts/run-env.mjs", "development", process.execPath, "-e", "console.log('SHOULD_NOT_START')"], { env, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /SHOULD_NOT_START/);
  assert.match(result.stderr, /local DATABASE_URL/);
  assert.doesNotMatch(result.stderr, /private|password/);
});
