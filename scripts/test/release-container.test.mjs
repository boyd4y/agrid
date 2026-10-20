import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { pullImage, migrate } from "../release/container.mjs";

const image = `ghcr.io/boyd4y/agrid@sha256:${"b".repeat(64)}`;

test("anonymous full image pull uses an empty ephemeral config, no inherited credentials, and always removes it", async () => {
  for (const fail of [false, true]) {
    let directory;
    const result = pullImage(image, async (command, args, options) => {
      assert.equal(command, "docker");
      assert.equal(args[0], "--config");
      directory = args[1];
      assert(existsSync(directory));
      assert(!existsSync(`${directory}/config.json`));
      assert.deepEqual(args.slice(2), ["pull", image]);
      assert.deepEqual(Object.keys(options.env), ["PATH"]);
      assert.equal(options.timeout, 300000);
      if (fail) throw new Error("private credential in stderr");
    });
    if (fail) await assert.rejects(result, /anonymous_docker_pull_failed_no_production_changes/);
    else await result;
    assert(!existsSync(directory));
  }
});

test("migration keeps database credentials out of argv, forwards no admin tokens and bounds container cleanup even on timeout", async () => {
  const databaseUrl = "postgresql://user:very-private@database.example/db";
  for (const fail of [false, true]) {
    const calls = [];
    const run = async (command, args, options) => {
      calls.push({ command, args, options });
      assert(!args.join(" ").includes("very-private"));
      if (args[0] === "run") {
        assert.equal(args.at(-1), "dist/db/migrate.js");
        assert.equal(options.env.DATABASE_URL, databaseUrl);
        assert.equal(options.env.DATABASE_URL_UNPOOLED, databaseUrl);
        assert.deepEqual(Object.keys(options.env).sort(), ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "PATH"]);
        assert.equal(options.timeout, 300000);
        if (fail) throw new Error("timeout private-credential");
      }
    };
    if (fail) await assert.rejects(() => migrate(image, databaseUrl, run), /migration_failed_or_timed_out_no_deployment/);
    else await migrate(image, databaseUrl, run);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].args.slice(0, 2), ["rm", "--force"]);
    assert.equal(calls[1].options.timeout, 30000);
  }
});
