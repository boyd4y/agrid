import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { parseEnv } from "node:util";
import { loadConfiguration, settings, prepareLocalFiles, port } from "../lib/cf-dev.mjs";

const database = "postgresql://fixture:private-pg-password@localhost:5432/cf_dev_config_agent_test";
async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "tabdo-cf-dev-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function fixture(t) {
  const root = await temporaryRoot(t);
  await mkdir(resolve(root, "apps/cloudflare"), { recursive: true });
  const original = {
    main: "src/index.ts",
    vars: { ENVIRONMENT: "development", APP_URL: "http://localhost:5173", BETTER_AUTH_URL: "http://localhost:5173", GATEWAY_ORIGIN: "http://host.docker.internal:8787" },
    hyperdrive: [{ binding: "DATABASE", id: "fixture-binding" }],
    r2_buckets: [{ binding: "FILES", bucket_name: "fixture-files" }],
    containers: [{ class_name: "Execution", images: {
      runner: { dockerfile: "sandbox/runtime/Dockerfile", build_context: "../.." },
      absolute: { dockerfile: resolve(root, "Dockerfile"), build_context: root },
    } }],
  };
  await writeFile(resolve(root, "apps/cloudflare/wrangler.jsonc"), JSON.stringify(original));
  return { root, original };
}

test("configuration merges .env, .env.cf, then inherited values including empty overrides", async t => {
  const root = await temporaryRoot(t);
  await writeFile(resolve(root, ".env"), 'DATABASE_URL="postgresql://fixture/base"\nPI_MODEL=base\nOPENROUTER_API_KEY=old\n');
  await writeFile(resolve(root, ".env.cf"), 'PI_MODEL=cf\nOPENROUTER_API_KEY=\nDEEPSEEK_API_KEY="fake-deepseek"\n');
  assert.deepEqual(await loadConfiguration(root, { PI_MODEL: "inherited", DEEPSEEK_API_KEY: "" }), {
    DATABASE_URL: "postgresql://fixture/base", PI_MODEL: "inherited", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "",
  });
});

test("missing optional env files are allowed; actual read failures propagate", async t => {
  const root = await temporaryRoot(t);
  assert.deepEqual(await loadConfiguration(root, { DATABASE_URL: database }), { DATABASE_URL: database });
  await mkdir(resolve(root, ".env"));
  await assert.rejects(loadConfiguration(root, {}), { code: "EISDIR" });
});

test("ports use defaults and accept range boundaries without binding sockets", () => {
  assert.equal(port(undefined, 5173, "PORT"), 5173);
  assert.equal(port("", 5173, "PORT"), 5173);
  assert.equal(port("1", 5173, "PORT"), 1);
  assert.equal(port("65535", 5173, "PORT"), 65535);
  const result = settings({ DATABASE_URL: database });
  assert.deepEqual([result.clientPort, result.workerPort, result.inspectorPort], [5173, 8787, 9231]);
  for (const value of ["0", "-1", "65536", "1.5", "NaN", "Infinity", "invalid"]) {
    assert.throws(() => port(value, 5173, "PORT"), /PORT must be an integer between 1 and 65535/);
  }
});

test("settings reject duplicate ports, invalid database protocols and missing database", () => {
  for (const overrides of [
    { CF_CLIENT_PORT: "8787" }, { CF_WORKER_PORT: "9231" }, { CF_INSPECTOR_PORT: "5173" },
  ]) assert.throws(() => settings({ DATABASE_URL: database, ...overrides }), /ports must be different/);
  assert.throws(() => settings({}), /Set DATABASE_URL/);
  for (const value of ["https://localhost/database", "redis://localhost", "not-a-url"]) {
    assert.throws(() => settings({ DATABASE_URL: value }), /valid PostgreSQL/);
  }
  assert.equal(settings({ DATABASE_URL: "postgres://fixture@localhost/database" }).database, "postgres://fixture@localhost/database");
});

test("ports determine browser/auth URLs and the container gateway unless explicitly configured", () => {
  const input = { DATABASE_URL: database, CF_CLIENT_PORT: "5199", CF_WORKER_PORT: "8799", CF_INSPECTOR_PORT: "9299" };
  const { variables } = settings(input);
  assert.equal(variables.APP_URL, "http://localhost:5199");
  assert.equal(variables.BETTER_AUTH_URL, variables.APP_URL);
  assert.equal(variables.GATEWAY_ORIGIN, "http://host.docker.internal:8799");
  assert.equal(settings({ ...input, CF_GATEWAY_ORIGIN: "http://fixture.gateway:8799" }).variables.GATEWAY_ORIGIN, "http://fixture.gateway:8799");
});

test("DeepSeek shortcut fills direct Pi defaults and supports provider overrides", () => {
  const base = { DATABASE_URL: database, DEEPSEEK_API_KEY: "fake-deepseek" };
  const { variables } = settings(base);
  assert.equal(variables.PI_API_KEY, "fake-deepseek");
  assert.equal(variables.PI_BASE_URL, "https://api.deepseek.com/v1");
  assert.equal(variables.PI_MODEL, "deepseek-flash");
  assert.equal(variables.PI_CONTEXT_WINDOW, "1048576");
  assert.equal(settings({ ...base, PI_CONTEXT_WINDOW: "65536", PI_MAX_OUTPUT_TOKENS: "2048" }).variables.PI_CONTEXT_WINDOW, "65536");
  assert.equal(settings({ ...base, PI_MAX_OUTPUT_TOKENS: "2048" }).variables.PI_MAX_OUTPUT_TOKENS, "2048");
  const custom = settings({ ...base, DEEPSEEK_BASE_URL: "https://model.fixture/v1", DEEPSEEK_MODEL: "deepseek-v4-pro" }).variables;
  assert.equal(custom.PI_BASE_URL, "https://model.fixture/v1");
  assert.equal(custom.PI_MODEL, "deepseek-v4-pro");
});

test("explicit Pi key wins over DeepSeek; an old OpenRouter key must be cleared explicitly", () => {
  const base = { DATABASE_URL: database, DEEPSEEK_API_KEY: "fake-deepseek", OPENROUTER_API_KEY: "fake-old-openrouter" };
  const direct = settings({ ...base, PI_API_KEY: "fake-direct", PI_BASE_URL: "https://direct.fixture", PI_MODEL: "direct" }).variables;
  assert.equal(direct.PI_API_KEY, "fake-direct");
  assert.equal(direct.PI_BASE_URL, "https://direct.fixture");
  assert.equal(direct.PI_MODEL, "direct");
  assert.equal(Object.hasOwn(direct, "PI_CONTEXT_WINDOW"), false);
  assert.equal(direct.OPENROUTER_API_KEY, "fake-old-openrouter");
  const cleared = settings({ ...base, PI_API_KEY: "", OPENROUTER_API_KEY: "" }).variables;
  assert.equal(cleared.PI_API_KEY, "fake-deepseek");
  assert.equal(Object.hasOwn(cleared, "OPENROUTER_API_KEY"), false);
});

test("only allowlisted runtime settings are extracted; database and unrelated secrets remain separate", () => {
  const input = Object.freeze({ DATABASE_URL: database, PI_API_KEY: "fake-model", PI_MODEL: "fixture", AI_RUN_POLL_MS: "250",
    RESEND_API_KEY: "fake-mail", EMAIL_FROM: "fixture@example.test", INTEGRATION_ENCRYPTION_KEY: "fixture-encryption",
    UNRELATED_SECRET: "must-not-forward", CLOUDFLARE_API_TOKEN: "must-not-forward-either" });
  const result = settings(input);
  assert.equal(result.database, database);
  assert.equal(result.variables.PI_API_KEY, "fake-model");
  assert.equal(result.variables.AI_RUN_POLL_MS, "250");
  assert.equal(result.variables.RESEND_API_KEY, "fake-mail");
  assert.equal(result.variables.INTEGRATION_ENCRYPTION_KEY, "fixture-encryption");
  for (const key of ["DATABASE_URL", "UNRELATED_SECRET", "CLOUDFLARE_API_TOKEN"]) assert.equal(Object.hasOwn(result.variables, key), false);
});

test("missing, short and example auth secrets use generated secrets instead of being forwarded", () => {
  for (const secret of [undefined, "short", " ".repeat(40), "dev-only-secret-change-me-32chars-min!!"]) {
    assert.equal(Object.hasOwn(settings({ DATABASE_URL: database, BETTER_AUTH_SECRET: secret }).variables, "BETTER_AUTH_SECRET"), false);
  }
  const secret = "fixture-auth-".repeat(4);
  assert.equal(settings({ DATABASE_URL: database, BETTER_AUTH_SECRET: secret }).variables.BETTER_AUTH_SECRET, secret);
});

test("local files persist private secrets, preserve source config and exclude PG/model secrets from Docker configuration", async t => {
  const { root, original } = await fixture(t);
  const values = settings({ DATABASE_URL: database, DEEPSEEK_API_KEY: 'fake-model-"quoted"' });
  const prepared = await prepareLocalFiles(root, values);
  assert.equal(prepared.directory, resolve(root, ".local/cf"));
  assert.equal(prepared.statePath, resolve(root, ".local/cf/state"));
  const secretPath = resolve(prepared.directory, "secrets.json");
  const secrets = JSON.parse(await readFile(secretPath, "utf8"));
  for (const key of ["BETTER_AUTH_SECRET", "INTEGRATION_ENCRYPTION_KEY"]) assert.ok(secrets[key].length >= 32);
  const generated = JSON.parse(await readFile(prepared.configPath, "utf8"));
  assert.equal(generated.main, resolve(root, "apps/cloudflare/src/index.ts"));
  assert.equal(generated.containers[0].images.runner.dockerfile, resolve(root, "apps/cloudflare/sandbox/runtime/Dockerfile"));
  assert.equal(generated.containers[0].images.runner.build_context, root);
  assert.deepEqual(generated.containers[0].images.absolute, original.containers[0].images.absolute);
  assert.deepEqual(generated.hyperdrive, original.hyperdrive);
  assert.deepEqual(generated.r2_buckets, original.r2_buckets);
  for (const key of ["PI_API_KEY", "PI_BASE_URL", "PI_MODEL", "BETTER_AUTH_SECRET", "INTEGRATION_ENCRYPTION_KEY"]) {
    assert.ok(generated.secrets.required.includes(key), `${key} must survive Wrangler's local secret binding filter`);
  }
  for (const key of Object.keys(original.vars)) assert.equal(generated.secrets.required.includes(key), false);
  for (const key of ["DATABASE_URL", "CLOUDFLARE_API_TOKEN", "UNRELATED_SECRET"]) assert.equal(generated.secrets.required.includes(key), false);
  assert.deepEqual(JSON.parse(await readFile(resolve(root, "apps/cloudflare/wrangler.jsonc"), "utf8")), original);
  const varsPath = resolve(prepared.directory, ".dev.vars");
  const varsText = await readFile(varsPath, "utf8");
  const vars = parseEnv(varsText);
  assert.equal(vars.PI_API_KEY, 'fake-model-"quoted"');
  assert.equal(vars.BETTER_AUTH_SECRET, secrets.BETTER_AUTH_SECRET);
  assert.equal(vars.INTEGRATION_ENCRYPTION_KEY, secrets.INTEGRATION_ENCRYPTION_KEY);
  assert.equal(varsText.includes(database), false);
  assert.equal(varsText.includes("private-pg-password"), false);
  const configText = JSON.stringify(generated);
  for (const secret of [database, "private-pg-password", values.variables.PI_API_KEY, ...Object.values(secrets)]) assert.equal(configText.includes(secret), false);
  if (process.platform !== "win32") {
    assert.equal((await stat(prepared.directory)).mode & 0o777, 0o700);
    for (const path of [secretPath, varsPath, prepared.configPath]) assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
  await prepareLocalFiles(root, values);
  assert.deepEqual(JSON.parse(await readFile(secretPath, "utf8")), secrets);
  const configured = settings({ DATABASE_URL: database, BETTER_AUTH_SECRET: "explicit-auth-".repeat(4), INTEGRATION_ENCRYPTION_KEY: "explicit-encryption-".repeat(3) });
  await prepareLocalFiles(root, configured);
  const overridden = parseEnv(await readFile(varsPath, "utf8"));
  assert.equal(overridden.BETTER_AUTH_SECRET, configured.variables.BETTER_AUTH_SECRET);
  assert.equal(overridden.INTEGRATION_ENCRYPTION_KEY, configured.variables.INTEGRATION_ENCRYPTION_KEY);
  assert.deepEqual(JSON.parse(await readFile(secretPath, "utf8")), secrets);
});

test("corrupt or invalid persisted private secrets fail instead of being silently replaced", async t => {
  const { root } = await fixture(t);
  const prepared = await prepareLocalFiles(root, settings({ DATABASE_URL: database }));
  const path = resolve(prepared.directory, "secrets.json");
  await writeFile(path, "{");
  await assert.rejects(prepareLocalFiles(root, settings({ DATABASE_URL: database })), SyntaxError);
  await writeFile(path, JSON.stringify({ BETTER_AUTH_SECRET: "short", INTEGRATION_ENCRYPTION_KEY: "short" }));
  await assert.rejects(prepareLocalFiles(root, settings({ DATABASE_URL: database })), /Invalid private CF development secrets file/);
});


test("dotenv serialization preserves quotes, comments and literal backslash sequences", async t => {
  const { root } = await fixture(t);
  for (const value of ["plain", '"quoted" # literal comment', "it's fine", "it's `fine`", String.raw`C:\fixture\path\n`]) {
    const prepared = await prepareLocalFiles(root, settings({ DATABASE_URL: database, PI_API_KEY: value }));
    assert.equal(parseEnv(await readFile(resolve(prepared.directory, ".dev.vars"), "utf8")).PI_API_KEY, value);
  }
});

test("dotenv serialization rejects multiline, NUL and unsafe quoting without exposing the value", async t => {
  const { root } = await fixture(t);
  const unsupported = ["fake-secret\nsecond-line", "fake-secret\rsecond-line", "fake-secret\0suffix", 'fake-secret\'`"all-quotes', "fake-secret'`" + String.raw`\n`];
  for (const value of unsupported) {
    await assert.rejects(prepareLocalFiles(root, settings({ DATABASE_URL: database, PI_API_KEY: value })), error => {
      assert.match(error.message, /Unsupported CF development variable PI_API_KEY/);
      assert.equal(error.message.includes("fake-secret"), false);
      return true;
    });
  }
});
