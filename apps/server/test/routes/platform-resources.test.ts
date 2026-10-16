import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../../src/business/db/factory.js";
import { createAuth } from "@tabdo/auth";
import { getAuth, getDatabase, getDatabaseClient, requirePlatformResources, withPlatformResources } from "../../src/resources/scope.js";
import { createApp } from "../../src/app.js";
import { member, organization, user, automationEvents } from "../../src/db/schema.js";
import { createTable, getTable } from "../../src/commands/index.js";
import type { BackgroundWakeup } from "../../src/business/background.js";

test("concurrent product HTTP requests isolate database/auth resources and restore nested scopes", { timeout: 30000 }, async () => {
  const connectionString = process.env.DATABASE_URL ?? "";
  assert(new URL(connectionString).pathname.endsWith("_agent_test"), "Use an isolated *_agent_test database");
  assert.throws(getDatabase, /entry point/);
  const databaseA = createDatabase({ connectionString, poolMax: 2 });
  const databaseB = createDatabase({ connectionString, poolMax: 2 });
  const settings = { appUrl: "http://localhost:5173", baseURL: "http://localhost:3001", production: false, sendInviteEmail: async () => {} };
  const authA = createAuth({ ...settings, database: databaseA.db, secret: "scoped-one-explicit-test-signing-secret-12345" });
  const authB = createAuth({ ...settings, database: databaseB.db, secret: "scoped-two-explicit-test-signing-secret-67890" });
  const hintsA: BackgroundWakeup[] = [], hintsB: BackgroundWakeup[] = [];
  const resourcesA = { database: databaseA, auth: authA, background: { notify: (hint: BackgroundWakeup) => { hintsA.push(hint); } } };
  const resourcesB = { database: databaseB, auth: authB, background: { notify: (hint: BackgroundWakeup) => { hintsB.push(hint); } } };
  const appA = createApp({ appUrl: settings.appUrl, resources: resourcesA });
  const appB = createApp({ appUrl: settings.appUrl, resources: resourcesB });
  const email = `scope-${randomUUID()}@example.test`, orgId = randomUUID();
  let releaseDetached!: () => void;
  const detachedGate = new Promise<void>(resolve => { releaseDetached = resolve; });
  let detached: Promise<void> | undefined;
  appA.get("/detached-scope", (c) => {
    detached = (async () => {
      await detachedGate;
      await getDatabaseClient()`select pg_sleep(0.01)`;
      assert.equal(getDatabase(), databaseA.db);
      assert.equal(getAuth(), authA);
    })();
    return c.json({ accepted: true });
  });
  const probes = [appA, appB].map((app, index) => {
    const expected = index === 0 ? resourcesA : resourcesB;
    app.get("/scope", async (c) => {
      const db = getDatabase();
      await getDatabaseClient()`select pg_sleep(0.02)`;
      assert.equal(getDatabase(), expected.database.db);
      assert.equal(getAuth(), expected.auth);
      await assert.rejects(withPlatformResources({ database: index === 0 ? databaseB : databaseA }, async () => {
        await getDatabaseClient()`select pg_sleep(0.01)`;
        assert.throws(getAuth, /not supplied/);
        throw new Error("nested fixture failure");
      }), /nested fixture failure/);
      assert.equal(getDatabase(), db);
      assert.equal(getAuth(), expected.auth);
      assert(Object.isFrozen(requirePlatformResources()));
      return c.json({ realm: index, email: (await getAuth().api.getSession({ headers: c.req.raw.headers }))?.user.email ?? null });
    });
    return app;
  });
  try {
    const signup = await appA.request("http://localhost:3001/api/auth/sign-up/email", { method: "POST",
      headers: { "content-type": "application/json", origin: settings.appUrl },
      body: JSON.stringify({ name: "Scoped HTTP fixture", email, password: "Scoped-fixture-password-123!" }) });
    assert.equal(signup.status, 200, await signup.clone().text());
    const body = await signup.json() as { user: { id: string } };
    const cookie = signup.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    await databaseA.db.insert(organization).values({ id: orgId, name: "Scoped", slug: orgId });
    await databaseA.db.insert(member).values({ id: randomUUID(), userId: body.user.id, organizationId: orgId, role: "owner" });
    const table = await withPlatformResources(resourcesA, () => createTable({ organizationId: orgId, name: "Scoped product table" }));
    const results = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
      const realm = index % 2;
      const response = await probes[realm].request("http://localhost:3001/scope", { headers: { cookie } });
      assert.equal(response.status, 200, await response.clone().text());
      return await response.json() as { realm: number; email: string | null };
    }));
    for (const result of results) assert.equal(result.email, result.realm === 0 ? email : null);
    const allowed = await appA.request("http://localhost:3001/api/tables", { headers: { cookie } });
    assert.equal(allowed.status, 200);
    assert(JSON.stringify(await allowed.json()).includes(table.id));
    assert.equal((await appB.request("http://localhost:3001/api/tables", { headers: { cookie } })).status, 401);
    const schema = await withPlatformResources(resourcesA, () => getTable({ tableId: table.id, organizationId: orgId }));
    async function command(name: string, input: unknown) {
      const response = await appA.request("http://localhost:3001/api/commands", { method: "POST",
        headers: { cookie, "content-type": "application/json", origin: settings.appUrl },
        body: JSON.stringify({ command: name, input }) });
      assert.equal(response.status, 200, await response.clone().text());
      return (await response.json()).result;
    }
    await command("createAutomation", { tableId: table.id, name: "HTTP wakeup regression",
      trigger: { type: "row_created" }, actions: [{ type: "update_field", columnId: schema.columns[0].id, value: "complete" }] });
    hintsA.length = 0;
    await command("addRow", { tableId: table.id, cells: { [schema.columns[0].id]: "HTTP committed row" } });
    assert.deepEqual(hintsA, [{ kind: "outbox" }], "real HTTP writes retain the post-commit background notifier");
    assert.deepEqual(hintsB, [], "background capabilities remain isolated between application instances");
    assert.equal((await appA.request("http://localhost:3001/detached-scope")).status, 200);
    assert.throws(getDatabase, /entry point/);
    releaseDetached();
    await detached;
    assert.throws(getDatabase, /entry point/, "resource scope must not leak into the caller");
  } finally {
    releaseDetached();
    await detached?.catch(() => {});
    await databaseA.db.delete(automationEvents).where(eq(automationEvents.organizationId, orgId));
    await databaseA.db.delete(organization).where(eq(organization.id, orgId));
    await databaseA.db.delete(user).where(eq(user.email, email));
    await Promise.all([databaseA.close(), databaseB.close()]);
  }
});
