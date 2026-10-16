import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

if (!process.env.DATABASE_URL?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");

test("retired Pi defaults migrate without changing explicit models, other harnesses, or persona fields", async () => {
  const { client } = await import("../../src/db/index.js");
  try {
    await client.begin(async tx => {
      await tx`CREATE TEMP TABLE agent_profile (id text PRIMARY KEY, persona jsonb) ON COMMIT DROP`;
      const cases = [
        ["free", { defaultHarness: "pi", defaultModel: "openrouter/free", systemPrompt: "Keep this persona" }],
        ["auto", { defaultModel: "openrouter/auto" }],
        ["explicit", { defaultHarness: "pi", defaultModel: "deepseek-v4-pro" }],
        ["claude", { defaultHarness: "claude", defaultModel: "openrouter/free" }],
        ["missing", {}],
      ] as const;
      for (const [id, persona] of cases) await tx`INSERT INTO agent_profile VALUES (${id}, ${JSON.stringify(persona)}::jsonb)`;
      const migration = readFileSync(new URL("../../drizzle/0028_pi_provider_defaults.sql", import.meta.url), "utf8");
      await tx.unsafe(migration);
      await tx.unsafe(migration);
      const profiles = await tx`SELECT id, persona FROM agent_profile`;
      for (const [id, persona] of cases) assert.deepEqual(profiles.find(row => row.id === id)?.persona,
        ["free", "auto"].includes(id) ? { ...persona, defaultModel: "__harness_default__" } : persona);
    });
  } finally { await client.end(); }
});
