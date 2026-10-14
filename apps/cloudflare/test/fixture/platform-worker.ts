import { Hono } from "hono";
import { ServiceError } from "@tabdo/backend/errors";
import { createCommandsRoute } from "@tabdo/backend/http/commands";
import { createDatabase } from "@tabdo/backend/database";
import { createPlatformAuth } from "@tabdo/backend/auth";
import { createPlatformSessionServices } from "@tabdo/backend/services/sessions";
import { CoordinationError, parseExecutionReference, type SessionServices } from "../../src/contracts.js";
import { createSessionCoordinator } from "../../src/coordinator.js";

function acquire(env: PlatformCoordinationTestEnv) {
  const database = createDatabase({ connectionString: env.PLATFORM_DATABASE.connectionString, poolMax: 1 });
  const auth = createPlatformAuth({ database: database.db, appUrl: "http://localhost:5173", baseURL: "http://localhost:8787", production: false,
    secret: env.PLATFORM_AUTH_SECRET, sendInviteEmail: async () => { throw new Error("Fixture never sends email"); } });
  return Promise.resolve({ auth, runtime: { database: database.db, now: () => new Date(), uuid: () => crypto.randomUUID() },
    identity: { database: database.db, resolveSession: (headers: Headers) => auth.api.getSession({ headers }) }, close: () => database.close() });
}

function mapped(env: PlatformCoordinationTestEnv): SessionServices {
  const platform = createPlatformSessionServices(() => acquire(env));
  const mapError = (error: unknown): never => {
    const status = error instanceof ServiceError ? error.status : 503;
    if ([400,401,403,404,409].includes(status)) throw new CoordinationError("Session access denied", status as 400|401|403|404|409);
    throw new CoordinationError("Session service unavailable", 503);
  };
  return {
    readOutput: input => platform.readOutput(input).catch(mapError),
    cancel: input => platform.cancel(input).catch(mapError),
  };
}

export class PlatformSessionCoordinator extends createSessionCoordinator<PlatformCoordinationTestEnv>(mapped, { pollIntervalMs: 25, pageSize: 2 }) {}

export default {
  async fetch(request: Request, env: PlatformCoordinationTestEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/auth/")) {
      const scope = await acquire(env);
      try { return await scope.auth.handler(request); }
      finally { await scope.close(); }
    }
    if (url.pathname === "/api/commands" || url.pathname === "/api/commands/") {
      const app = new Hono();
      app.route("/api/commands", createCommandsRoute(async () => {
        const scope = await acquire(env);
        return { commands: { ...scope.runtime, automationQueueName: "automation" }, identity: scope.identity, close: scope.close };
      }));
      return app.fetch(request);
    }
    try {
      const reference = parseExecutionReference({ executionId: url.searchParams.get("executionId"), runId: url.searchParams.get("runId"), threadId: url.searchParams.get("threadId") });
      const credentials = { cookie: request.headers.get("cookie") ?? undefined, authorization: request.headers.get("authorization") ?? undefined };
      const coordinator = env.PLATFORM_SESSIONS.getByName(`thread:${reference.threadId}`);
      if (url.pathname === "/cancel") {
        // Public route validates before DO RPC; the cancellation callback rechecks current membership through the write.
        await mapped(env).readOutput({ reference, credentials, after: 0, limit: 1 });
        await coordinator.cancel({ reference, credentials });
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/stream") return coordinator.fetch(request);
      return new Response(null, { status: 404 });
    } catch (error) {
      return new Response(null, { status: error instanceof CoordinationError ? error.status : 503 });
    }
  },
} satisfies ExportedHandler<PlatformCoordinationTestEnv>;
