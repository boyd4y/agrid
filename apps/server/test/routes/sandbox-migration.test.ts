import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";

assert(new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_agent_test"));
test("provider migration preserves legacy local/Vercel identities and opaque checkpoints", async () => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const schema = `sandbox_migration_${randomUUID().replaceAll("-", "")}`;
  const rollback = new Error("fixture rollback");
  try {
    await assert.rejects(sql.begin(async tx => {
      await tx.unsafe(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}"`);
      await tx.unsafe('CREATE TABLE agent_runtime_sessions (id text PRIMARY KEY, mode text NOT NULL, sandbox_id text NOT NULL, resume_state jsonb)');
      const opaque = { vendor: { private: ["unchanged", 17] }, token: "fixture-state-only" };
      await tx`INSERT INTO agent_runtime_sessions VALUES ('local-old','local','local-id',${sql.json(opaque)}), ('remote-old','sandbox','vercel-name',${sql.json(opaque)}), ('new','sandbox','reserved-id',null)`;
      const raw = readFileSync(new URL("../../drizzle/0032_sandbox_providers.sql", import.meta.url), "utf8");
      for (const statement of raw.split("--> statement-breakpoint").filter(value => value.trim())) await tx.unsafe(statement);
      const rows = await tx`SELECT * FROM agent_runtime_sessions ORDER BY id`;
      assert.equal(rows[0].provider, "local");assert.equal(rows[0].sandbox_id, "local-id");assert.deepEqual(rows[0].resume_state, opaque);assert.equal(rows[0].sandbox_created, true);
      assert.equal(rows[1].provider, "vercel");assert.equal(rows[1].sandbox_id, "reserved-id");assert.equal(rows[1].sandbox_created, false);
      assert.equal(rows[2].provider, "vercel");assert.equal(rows[2].sandbox_id, "vercel-name");assert.deepEqual(rows[2].resume_state, opaque);assert.equal(rows[2].sandbox_created, true);
      await assert.rejects(tx.savepoint(async save => { await save`INSERT INTO agent_runtime_sessions(id,mode,sandbox_id,provider) VALUES ('invalid','local','id','railway')`; }), { code: "23514" });
      throw rollback;
    }), error => error === rollback);
  } finally { await sql.end(); }
});
