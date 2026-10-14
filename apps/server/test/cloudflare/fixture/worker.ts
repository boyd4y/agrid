// Local factory contract test only. This is not the Tabdo product Worker entry.
import { createDatabase } from "@tabdo/platform/database";
import { createPlatformAuth } from "@tabdo/platform/auth";

export default {
  async fetch(request, env) {
    const connectionString = env.HYPERDRIVE.connectionString;
    if (!new URL(connectionString).pathname.endsWith("_agent_test")) throw new Error("Use an isolated *_agent_test database");
    // A request owns its client; no pool/auth instance is shared across events.
    const database = createDatabase({ connectionString, poolMax: 1, prepare: true });
    try {
      const url = new URL(request.url), realm = url.searchParams.get("realm") === "two" ? "two" : "one";
      if (url.pathname === "/probe") {
        const [row] = await database.client`select pg_backend_pid() as pid, current_database() as name, pg_sleep(0.02)`;
        return Response.json({ realm, pid: row.pid, name: row.name });
      }
      const auth = createPlatformAuth({ database: database.db, appUrl: "http://localhost:5173", baseURL: url.origin,
        secret: realm === "one" ? env.AUTH_SECRET_ONE : env.AUTH_SECRET_TWO, production: false, sendInviteEmail: async () => {} });
      if (url.pathname === "/session") {
        const session = await auth.api.getSession({ headers: request.headers });
        return Response.json({ realm, email: session?.user.email ?? null, kind: session?.user.kind ?? null });
      }
      return await auth.handler(request);
    } finally { await database.close(); }
  },
} satisfies ExportedHandler<PlatformFactoryTestEnv>;
