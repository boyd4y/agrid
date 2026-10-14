import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "@tabdo/backend/database";
import { user } from "../../src/db/schema.js";
import { createPlatformAuth, assertProductionAuthSecret } from "@tabdo/backend/auth";
import { createApp } from "../../src/app.js";
import { client } from "../../src/db/index.js";

test("explicit Better Auth factories preserve real sessions and do not share signing configuration", async () => {
  const connectionString = process.env.DATABASE_URL ?? "";
  assert(new URL(connectionString).pathname.endsWith("_agent_test"), "Use an isolated *_agent_test database");
  const database = createDatabase({ connectionString, poolMax: 2, prepare: false });
  const email = `factory-${randomUUID()}@example.test`;
  const settings = { database: database.db, appUrl: "http://localhost:5173", baseURL: "http://localhost:3001",
    production: false, sendInviteEmail: async () => {} };
  const authA = createPlatformAuth({ ...settings, secret: "factory-one-meaningful-test-secret-12345" });
  const authB = createPlatformAuth({ ...settings, secret: "factory-two-independent-test-secret-67890" });
  try {
    const response = await authA.api.signUpEmail({ body: { name: "Factory test", email, password: "Factory-fixture-123!" }, asResponse: true });
    assert.equal(response.status, 200);
    const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    assert(cookie);
    const session = await authA.api.getSession({ headers: new Headers({ cookie }) });
    assert.equal(session?.user.email, email);
    assert.equal(session?.user.kind, "human");
    assert.equal(await authB.api.getSession({ headers: new Headers({ cookie }) }), null);
    const appA = createApp({ appUrl: "https://one.example.test", resources: { database, auth: authA } });
    const appB = createApp({ appUrl: "https://two.example.test", resources: { database, auth: authB } });
    const request = { method: "OPTIONS", headers: { origin: "https://one.example.test", "access-control-request-method": "GET" } };
    assert.equal((await appA.request("/api/tables", request)).headers.get("access-control-allow-origin"), "https://one.example.test");
    assert.notEqual((await appB.request("/api/tables", request)).headers.get("access-control-allow-origin"), "https://one.example.test");
    assert.equal((await appA.request("/api/tables")).status, 401);
  } finally {
    await database.db.delete(user).where(eq(user.email, email));
    await database.close();
    await client.end();
  }
});

test("resource factories retain production secret and configuration validation", () => {
  for (const value of [undefined, "", "short", "x".repeat(40), "replace-with-32+-char-secret"])
    assert.throws(() => assertProductionAuthSecret(value));
  assert.equal(assertProductionAuthSecret("independent-valid-test-secret-for-factory"), "independent-valid-test-secret-for-factory");
  assert.throws(() => createDatabase({ connectionString: "", poolMax: 1 }));
  assert.throws(() => createDatabase({ connectionString: "postgresql://fixture", poolMax: 0 }));
});
