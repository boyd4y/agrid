import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase } from "../../src/business/db/factory.js";
import { assertSchemaReady, checkSchemaReady } from "../../src/db/schema-ready.js";
import { withPlatformResources } from "../../src/resources/scope.js";

test("readiness rejects missing runtime columns before accepting chat requests", async () => {
  const connectionString = process.env.DATABASE_URL ?? "";
  assert(new URL(connectionString).pathname.endsWith("_agent_test"), "Use an isolated *_agent_test database");
  const database = createDatabase({ connectionString, poolMax: 1 });
  const rollback = new Error("fixture rollback");
  try {
    await withPlatformResources({ database }, async () => {
      assert.deepEqual(await checkSchemaReady(), { ok: true });
      await assertSchemaReady();
    });
    for (const column of ["provider", "sandbox_created"]) {
      await assert.rejects(database.client.begin(async (tx) => {
        await tx.unsafe(`ALTER TABLE public.agent_runtime_sessions RENAME COLUMN "${column}" TO fixture_missing_column`);
        await withPlatformResources({ database: { ...database, client: tx as unknown as typeof database.client } }, async () => {
          const result = await checkSchemaReady();
          assert.equal(result.ok, false);
          if (!result.ok) assert(result.missing.some((name) => name.startsWith(`agent_runtime_sessions.${column} `)));
          await assert.rejects(assertSchemaReady(), new RegExp(`agent_runtime_sessions\\.${column}.*pnpm db:migrate`));
        });
        throw rollback;
      }), (error) => error === rollback);
    }
    await withPlatformResources({ database }, async () => {
      assert.deepEqual(await checkSchemaReady(), { ok: true });
    });
  } finally {
    await database.close();
  }
});
