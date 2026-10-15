import assert from "node:assert/strict";
import { test } from "node:test";
import { pgTable, text } from "drizzle-orm/pg-core";
import { createDatabase } from "../src/index.js";

test("database factory builds queries for an injected unrelated schema without product tables", async () => {
  const receipts = pgTable("independent_receipts", { id: text("id").primaryKey() });
  const resource = createDatabase({ connectionString: "postgresql://fixture:fixture@127.0.0.1:1/unused_agent_test", poolMax: 1, schema: { receipts } });
  try {
    const query = resource.db.select().from(receipts).toSQL();
    assert.match(query.sql, /"independent_receipts"/);
    assert.equal("agentProfile" in resource.db.query, false);
  } finally { await resource.close(); }
});
test("database configuration is checked before opening a pool", () => {
  assert.throws(() => createDatabase({ connectionString: "", poolMax: 1, schema: {} }), /connection string/);
  assert.throws(() => createDatabase({ connectionString: "postgresql://fixture/unused_agent_test", poolMax: 0, schema: {} }), /pool size/);
});
