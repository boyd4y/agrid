import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { createTestHarness } from "wrangler";
import { createDatabase } from "../../src/db/factory.js";
import { user } from "../../src/db/schema.js";

const connectionString = process.env.DATABASE_URL ?? "";
if (!connectionString || !new URL(connectionString).pathname.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");

test("PG and Better Auth factories run in workerd with per-request resources and isolated signing configuration", { timeout: 60000 }, async () => {
  const root = fileURLToPath(new URL("./fixture/", import.meta.url));
  const config = JSON.parse(await readFile(new URL("./fixture/wrangler.jsonc", import.meta.url), "utf8"));
  config.hyperdrive[0].localConnectionString = connectionString;
  const server = createTestHarness({ root, workers: [{ config }] });
  const database = createDatabase({ connectionString, poolMax: 2 });
  const email = `workerd-${randomUUID()}@example.test`;
  try {
    await server.listen();
    const probe = await server.fetch("/probe");assert.equal(probe.status, 200);
    const resource = await probe.json() as { name: string; pid: number };
    assert.equal(resource.name, new URL(connectionString).pathname.slice(1));
    const [activity] = await database.client`select count(*)::int as remaining from pg_stat_activity where pid=${resource.pid}`;
    assert.equal(activity.remaining, 0, "the Worker closes its request client before returning");
    const signup = await server.fetch("/api/auth/sign-up/email?realm=one", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173" },
      body: JSON.stringify({ name: "Workerd factory fixture", email, password: "Workerd-fixture-password-123!" }) });
    assert.equal(signup.status, 200, await signup.clone().text());
    const cookie = signup.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");assert(cookie);
    const results = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
      const realm = index % 2 === 0 ? "one" : "two";
      const response = await server.fetch(`/session?realm=${realm}`, { headers: { cookie } });
      assert.equal(response.status, 200);
      return await response.json() as { realm: string; email: string | null; kind: string | null };
    }));
    for (const result of results) {
      assert.equal(result.email, result.realm === "one" ? email : null);
      assert.equal(result.kind, result.realm === "one" ? "human" : null);
    }
    const logout = await server.fetch("/api/auth/sign-out?realm=one", { method: "POST", headers: { cookie, "content-type": "application/json", origin: "http://localhost:5173" }, body: "{}" });
    assert.equal(logout.status, 200, await logout.clone().text());
    const signedOut = await (await server.fetch("/session?realm=one", { headers: { cookie } })).json() as { email: string | null };
    assert.equal(signedOut.email, null, "session revocation is visible to a new request and client");
  } finally {
    await server.close();
    try { await database.db.delete(user).where(eq(user.email, email)); }
    finally { await database.close(); }
  }
});
