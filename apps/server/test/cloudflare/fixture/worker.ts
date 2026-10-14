// Local factory contract test only. This is not the Tabdo product Worker entry.
import { createDatabase } from "@tabdo/backend/database";
import { createPlatformAuth } from "@tabdo/backend/auth";
import { getAuth, getDatabaseClient, requirePlatformResources, withPlatformResources } from "@tabdo/backend/resources";
import { resolveActor } from "../../../src/auth/actor.js";
import { resolveChatAgentConfiguration, buildChatAgentInstructions } from "../../../src/harness/agent-admission.js";
import { resolveNativeConfiguration } from "../../../src/harness/runtime-configuration.js";

export default {
  async fetch(request, env) {
    const connectionString = env.HYPERDRIVE.connectionString;
    if (!new URL(connectionString).pathname.endsWith("_agent_test")) throw new Error("Use an isolated *_agent_test database");
    // A request owns its client; no pool/auth instance is shared across events.
    const database = createDatabase({ connectionString, poolMax: 1, prepare: true });
    try {
      const url = new URL(request.url), realm = url.searchParams.get("realm") === "two" ? "two" : "one";
      const auth = createPlatformAuth({ database: database.db, appUrl: "http://localhost:5173", baseURL: url.origin,
        secret: realm === "one" ? env.AUTH_SECRET_ONE : env.AUTH_SECRET_TWO, production: false, sendInviteEmail: async () => {} });
      return await withPlatformResources({ database, auth }, async () => {
        if (url.pathname === "/agent-admission") {
          const actor = await resolveActor(request);
          if (!actor?.organizationId) return Response.json({ error: "unauthorized" }, { status: 401 });
          try {
            const context = { context: { page: "ai" as const }, resourceKey: "workspace", system: "verified fixture workspace" };
            const configuration = await resolveChatAgentConfiguration({ actor, agentId: url.searchParams.get("agentId") ?? "", context });
            resolveNativeConfiguration({ harness: configuration.harness, mode: configuration.mode, modelId: configuration.modelId,
              env: { OPENROUTER_API_KEY: "fixture-unused-provider-key" } });
            const instructions = buildChatAgentInstructions(configuration, context, "fixture skill policy");
            return Response.json({ profileId: configuration.profile.id, harness: configuration.harness, modelId: configuration.modelId,
              mode: configuration.mode, disabledTools: configuration.disabledTools, agentsDocument: instructions.agentsDocument });
          } catch (error) {
            if (error instanceof Error && "status" in error && typeof error.status === "number") return Response.json({ error: error.message }, { status: error.status });
            throw error;
          }
        }
        if (url.pathname === "/probe") {
          const [row] = await getDatabaseClient()`select pg_backend_pid() as pid, current_database() as name, pg_sleep(0.02)`;
          return Response.json({ realm, pid: row.pid, name: row.name });
        }
        if (url.pathname === "/nested") {
          const nested = createDatabase({ connectionString, poolMax: 1, prepare: true });
          try {
            try {
              await withPlatformResources({ database: nested }, async () => {
                await getDatabaseClient()`select pg_sleep(0.01)`;
                if (requirePlatformResources().database !== nested) throw new Error("Scope mismatch");
                try { getAuth(); } catch { throw new Error("expected nested failure"); }
                throw new Error("Nested database-only scope inherited authentication");
              });
            } catch (error) {
              if (!(error instanceof Error) || error.message !== "expected nested failure") throw error;
            }
            if (requirePlatformResources().database !== database || getAuth() !== auth) throw new Error("Outer scope was not restored");
            return Response.json({ restored: true });
          } finally { await nested.close(); }
        }
        if (url.pathname === "/session") {
          await getDatabaseClient()`select pg_sleep(0.02)`;
          const session = await getAuth().api.getSession({ headers: request.headers });
          return Response.json({ realm, email: session?.user.email ?? null, kind: session?.user.kind ?? null });
        }
        return await getAuth().handler(request);
      });
    } finally { await database.close(); }
  },
} satisfies ExportedHandler<PlatformFactoryTestEnv>;
