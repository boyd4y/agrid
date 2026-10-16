import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test"));
test("unification preserves existing key hashes and per-table capabilities without adding write grants", async () => {
  const sql = postgres(url, { max: 1 });
  const schema = `key_migration_${randomUUID().replaceAll("-", "")}`;
  const rolledBack = new Error("fixture rollback");
  try {
    await assert.rejects(sql.begin(async tx => {
      await tx.unsafe(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}"`);
      await tx.unsafe('CREATE TABLE "user" (id text PRIMARY KEY); CREATE TABLE organization (id text PRIMARY KEY); CREATE TABLE tables (id uuid PRIMARY KEY, organization_id text NOT NULL REFERENCES organization(id))');
      for (const name of ["0022_user_api_keys", "0029_site_api"]) {
        const raw = readFileSync(new URL(`../../drizzle/${name}.sql`, import.meta.url), "utf8");
        for (const statement of raw.split("--> statement-breakpoint").filter(x => x.trim())) await tx.unsafe(statement);
      }
      const org = randomUUID(), user = randomUUID(), table = randomUUID(), other = randomUUID(), personal = randomUUID(), site = randomUUID();
      await tx`INSERT INTO organization VALUES (${org})`; await tx`INSERT INTO "user" VALUES (${user})`;
      await tx`INSERT INTO tables VALUES (${table}, ${org}), (${other}, ${org})`;
      await tx`INSERT INTO user_api_keys (id,user_id,organization_id,name,key_hash,prefix) VALUES (${personal},${user},${org},'Existing API','personal-hash','tab_old')`;
      await tx`INSERT INTO site_api_keys (id,created_by,organization_id,name,key_hash,prefix,can_read,can_create) VALUES (${site},${user},${org},'Existing form','site-hash','tab_pub_old',false,true)`;
      await tx`INSERT INTO site_api_key_tables VALUES (${site},${table})`;
      const raw = readFileSync(new URL("../../drizzle/0030_unified_api_keys.sql", import.meta.url), "utf8");
      for (const statement of raw.split("--> statement-breakpoint").filter(x => x.trim())) await tx.unsafe(statement);
      const keys = await tx`SELECT id,key_hash FROM api_keys ORDER BY name`;
      assert.deepEqual(keys.map(k => k.key_hash), ["personal-hash", "site-hash"]);
      const apiGrants = await tx`SELECT * FROM api_key_tables WHERE key_id=${personal}`;
      assert.equal(apiGrants.length, 2); assert(apiGrants.every(g => g.can_read && g.can_create && g.can_update && g.can_delete));
      const siteGrants = await tx`SELECT * FROM api_key_tables WHERE key_id=${site}`;
      assert.equal(siteGrants.length, 1); assert.equal(siteGrants[0].can_create, true);
      assert.equal(siteGrants[0].can_read, false); assert.equal(siteGrants[0].can_update, false); assert.equal(siteGrants[0].can_delete, false);
      assert.equal((await tx`SELECT to_regclass('site_api_keys') AS old`)[0].old, null);
      throw rolledBack;
    }), error => error === rolledBack);
  } finally { await sql.end(); }
});
