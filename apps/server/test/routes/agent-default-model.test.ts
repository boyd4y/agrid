import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { createDatabase } from "../../src/business/db/factory.js";
import { createAuth } from "@tabdo/auth";
import { withPlatformResources } from "../../src/resources/scope.js";
import { createApp } from "../../src/app.js";
import { agentProfile, member, organization, user } from "../../src/db/schema.js";
import { client } from "../../src/db/index.js";
import { resolveActor } from "../../src/auth/actor.js";
import { resolveChatContext } from "../../src/chat/context.js";
import { resolveChatAgentConfiguration } from "../../src/harness/agent-admission.js";
import { resolveNativeConfiguration } from "../../src/harness/runtime-configuration.js";
import { NATIVE_DEFAULT_MODEL } from "../../src/harness/contracts.js";
import { seedRichDemoWorkspace, DEMO_AGENT_NAME } from "../../src/db/seed-demo.js";

test("new API and demo agents inherit the configured Pi model", async () => {
  const connectionString = process.env.DATABASE_URL ?? "";
  assert(new URL(connectionString).pathname.endsWith("_agent_test"), "Use an isolated *_agent_test database");
  const database = createDatabase({ connectionString, poolMax: 2, prepare: false });
  const auth = createAuth({ database: database.db, appUrl: "http://localhost:5173", baseURL: "http://localhost:3001",
    secret: "agent-model-meaningful-local-test-secret", production: false, sendInviteEmail: async () => {} });
  const resources = { database, auth };
  const app = createApp({ appUrl: "http://localhost:5173", resources });
  const cookies = new Map<string, string>();
  const users = new Set<string>();
  let organizationId: string | undefined;
  const call = async (path: string, body: unknown, expectedStatus = 200) => {
    const response = await app.request(`/api${path}`, { method: "POST", headers: { origin: "http://localhost:5173", "content-type": "application/json",
      cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") }, body: JSON.stringify(body) });
    assert.equal(response.status, expectedStatus, path);
    for (const cookie of response.headers.getSetCookie()) {
      const value = cookie.split(";")[0], position = value.indexOf("=");
      cookies.set(value.slice(0, position), value.slice(position + 1));
    }
    return response.json();
  };
  try {
    const signedUp = await call("/auth/sign-up/email", { name: "Default model owner", email: `model-${randomUUID()}@local.test`, password: "Model-fixture-123!" });
    users.add(signedUp.user.id);
    organizationId = (await call("/auth/organization/create", { name: "Default model fixture", slug: `model-${randomUUID()}` })).id;
    await call("/auth/organization/set-active", { organizationId });
    const inherited = await call("/members/agents", { name: "Inherited provider" }, 201);
    assert.equal(inherited.member.agent.persona.defaultModel, NATIVE_DEFAULT_MODEL);
    users.add(inherited.member.userId);
    await withPlatformResources(resources, async () => {
      const actor = await resolveActor(new Request("http://localhost:3001/api/members", { headers: {
        cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") } }));
      assert(actor?.organizationId);
      const context = await resolveChatContext({ page: "ai" }, actor);
      const admitted = await resolveChatAgentConfiguration({ actor, context, agentId: inherited.member.id });
      const configured = resolveNativeConfiguration({ harness: admitted.harness, mode: admitted.mode, modelId: admitted.modelId,
        env: { PI_API_KEY: "fixture-key", PI_BASE_URL: "http://localhost:1234/v1", PI_MODEL: "direct-model" } });
      assert.equal(configured.harness, "pi");
      if (configured.harness === "pi") assert.equal(configured.adapter.model.id, "direct-model");
      await seedRichDemoWorkspace(organizationId!);
      const [demo] = await database.db.select().from(agentProfile).where(and(eq(agentProfile.organizationId, organizationId!), eq(agentProfile.displayName, DEMO_AGENT_NAME)));
      assert.equal(demo.persona.defaultModel, NATIVE_DEFAULT_MODEL);
    });
  } finally {
    if (organizationId) {
      for (const membership of await database.db.select().from(member).where(eq(member.organizationId, organizationId))) users.add(membership.userId);
      await database.db.delete(organization).where(eq(organization.id, organizationId));
    }
    if (users.size) await database.db.delete(user).where(inArray(user.id, [...users]));
    await database.close();
    await client.end();
  }
});
