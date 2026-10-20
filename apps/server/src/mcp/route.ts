import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { RequestScope, RequestScopeResolver } from "../business/http/request.js";
import { resolveActor } from "../business/auth/actor.js";
import { resolveSiteKey } from "../business/data-api/keys.js";
import { dispatchKeyCommand, keyCommandRateLimitKind } from "../business/data-api/commands.js";
import { dispatchCommand } from "../business/services/command-dispatch.js";
import { requireWorkspace } from "../business/tenant/workspace.js";
import { ServiceError } from "../business/errors.js";
import { BlogError } from "../business/blogs/errors.js";
import { CalendarError } from "../business/calendar/errors.js";
import { DocumentError } from "../business/documents/errors.js";
import { createMcpServer } from "./tools.js";

/** Cookie-free, stateless MCP. Every HTTP request owns its identity and transport. */
export function createMcpRoute(acquire: RequestScopeResolver, options: {
  publicOrigin: string;
  allowedOrigins: readonly string[];
  clientIp?: (context: Context) => string;
}) {
  const publicOrigin = new URL(options.publicOrigin).origin;
  const allowedOrigins = new Set(options.allowedOrigins);
  const route = new Hono();
  route.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    c.header("Referrer-Policy", "no-referrer");
    const origin = c.req.header("Origin");
    if (origin !== undefined && !allowedOrigins.has(origin)) return c.json({ error: "Origin is not allowed" }, 403);
    return next();
  });
  route.use("*", cors({ origin: [...allowedOrigins], credentials: false,
    allowMethods: ["POST", "GET", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Workspace-Id", "MCP-Protocol-Version", "MCP-Session-Id", "Accept", "Idempotency-Key"],
    exposeHeaders: ["MCP-Protocol-Version"], maxAge: 600,
  }));
  route.all("/", async c => {
    // Do not pass Cookie, X-Tabdo-Key or query parameters into identity resolution.
    const authorization = c.req.header("Authorization");
    if (!authorization || !/^Bearer (?:tab_|agt_)[A-Za-z0-9_-]+$/i.test(authorization)) {
      c.header("WWW-Authenticate", "Bearer");
      return c.json({ error: "A valid Bearer API key is required" }, 401);
    }
    let scope: RequestScope | undefined;
    let server: ReturnType<typeof createMcpServer> | undefined;
    let transport: WebStandardStreamableHTTPServerTransport | undefined;
    try {
      scope = await acquire(c.req.raw);
      const secret = authorization.slice(7);
      const isTableKey = secret.toLowerCase().startsWith("tab_");
      const headers = new Headers({ Authorization: authorization });
      const workspaceId = c.req.header("X-Workspace-Id");
      if (workspaceId !== undefined) headers.set("X-Workspace-Id", workspaceId);
      const identityRequest = new Request(`${publicOrigin}/mcp`, { headers });
      const principal = isTableKey ? await resolveSiteKey(scope.commands.database, secret) : undefined;
      const actor = isTableKey ? undefined : await resolveActor(identityRequest, { ...scope.identity, resolveSession: async () => null });
      if (!principal && !actor) {
        c.header("WWW-Authenticate", "Bearer");
        return c.json({ error: "Invalid API key" }, 401);
      }
      if (principal && workspaceId !== undefined) await requireWorkspace({ database: scope.commands.database, workspaceId }, principal.organizationId);
      if (["GET", "DELETE"].includes(c.req.method)) {
        c.header("Allow", "POST, OPTIONS");
        return c.json({ error: "Method not allowed" }, 405);
      }
      const requestScope = scope;
      const siteContext = principal ? { principal, secret, baseUrl: publicOrigin, fileAuth: "bearer" as const } : undefined;
      server = createMcpServer(async (command, input) => {
        try {
          if (siteContext) {
            if (!requestScope.siteRateLimit) throw new ServiceError(503, { message: "API rate limiting is unavailable" });
            await requestScope.siteRateLimit({ keyId: siteContext.principal.id, ip: options.clientIp?.(c) ?? "unknown", kind: keyCommandRateLimitKind(command) });
            return (await dispatchKeyCommand(requestScope.commands, siteContext, { command, input }, c.req.header("Idempotency-Key"))).result;
          }
          return (await dispatchCommand(requestScope.commands, actor!, { command, input })).result;
        } catch (error) {
          const status = error instanceof ServiceError ? error.status : error instanceof Error && error.message.includes("版本冲突") ? 409 : 400;
          const code = error instanceof BlogError || error instanceof CalendarError || error instanceof DocumentError ? error.code :
            error instanceof z.ZodError ? "BAD_INPUT" : ({ 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 429: "RATE_LIMITED", 503: "SERVICE_UNAVAILABLE" } as Record<number, string>)[status] ?? "REQUEST_FAILED";
          throw Object.assign(new Error(error instanceof ServiceError ? error.message : error instanceof z.ZodError ? "Invalid request data" : !siteContext && error instanceof Error ? error.message : "Request could not be completed"), { code, status });
        }
      });
      transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 8 * 1024 * 1024 });
      await server.connect(transport);
      // JSON mode resolves only once the response is complete, so cleanup cannot
      // cut off a live SSE stream. No cross-request sessions or resumable state.
      return await transport.handleRequest(c.req.raw);
    } catch (error) {
      if (error instanceof ServiceError) {
        if (error.status === 401) c.header("WWW-Authenticate", "Bearer");
        return c.json({ error: error.message }, error.status as 400);
      }
      try { scope?.logger?.error("mcp.request", error instanceof Error ? error.name : "unknown"); } catch { /* Observation cannot change the response. */ }
      return c.json({ error: "Request could not be completed" }, 500);
    } finally {
      // Cleanup must not replace an already committed tool response.
      for (const close of [() => server?.close(), () => transport?.close(), () => scope?.close()]) {
        try { await close(); } catch { /* The composition owns any shared pool. */ }
      }
    }
  });
  return route;
}
