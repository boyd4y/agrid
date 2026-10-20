import { createMcpRoute } from "./mcp/route.js";
import { acquireRequestScope } from "./services/http-scope.js";
import { getConnInfo } from "@hono/node-server/conninfo";
import { sitesRoute, siteAssetsRoute } from "./routes/sites.js";
import { siteApiRoute, siteKeysRoute } from "./routes/site-api.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { tablesRoute } from "./routes/tables.js";
import { rowsRoute } from "./routes/rows.js";
import { columnsRoute } from "./routes/columns.js";
import { createChatRoute } from "./routes/chat.js";
import { threadsRoute } from "./routes/threads.js";
import { membersRoute } from "./routes/members.js";
import { commandsRoute } from "./routes/commands.js";
import { automationsRoute } from "./routes/automations.js";
import { reportsRoute } from "./routes/reports.js";
import { integrationsRoute } from "./routes/integrations.js";
import { webhookEndpointsRoute, webhooksRoute } from "./routes/webhooks.js";
import { apiKeysRoute } from "./routes/api-keys.js";
import { filesRoute } from "./routes/files.js";
import { skillsRoute } from "./routes/skills.js";
import { getAuth, withPlatformResources, type PlatformResources } from "./resources/scope.js";
import { checkSchemaReady } from "./db/schema-ready.js";
import { nativeDrainStarted, registerNativeRun } from "./harness/drain.js";


/** Shared route assembly. The caller owns the supplied resources' lifetime. */
export function createApp(options: { appUrl: string; resources: PlatformResources }) {
  const appUrl = options.appUrl;
  const resources = Object.freeze({ ...options.resources });
  const app = new Hono();

  app.use("*", (_c, next) => withPlatformResources(resources, next));

  // MCP never logs request URLs, which may contain mistakenly supplied secrets.
  const requestLogger = logger();
  app.use("*", (c, next) => c.req.path === "/mcp" || c.req.path.startsWith("/mcp/") ? next() : requestLogger(c, next));
  app.route("/mcp", createMcpRoute(acquireRequestScope, {
    publicOrigin: appUrl,
    allowedOrigins: [new URL(appUrl).origin],
    clientIp(c) { try { return getConnInfo(c).remote.address ?? "unknown"; } catch { return "unknown"; } },
  }));
  app.use("/api/chat", async (c, next) => {
    if (nativeDrainStarted()) return c.json({ error: "服务正在保存当前执行，请稍后重试" }, 503);
    // Cover admission/metadata/lease waits before the detached stream takes ownership.
    const release = registerNativeRun();
    try { await next(); } finally { release(); }
  });
  // Mount the cookie-free public data API before management CORS and identity middleware.
  app.route("/api", siteApiRoute);
  app.route("/", siteAssetsRoute);

  app.use(
    "*",
    cors({
      origin: [appUrl, "http://localhost:5173", "http://127.0.0.1:5173"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS", "PUT"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    })
  );

  app.get("/api/health", async (c) => {
    const schema = await checkSchemaReady();
    return c.json({
      ok: schema.ok,
      service: "tabdo",
      multiHarness: true,
      auth: true,
      automations: true,
      schema,
    }, schema.ok ? 200 : 503);
  });

  app.get("/api/public/auth-features", (c) => c.json({ google: Boolean(getAuth().options.socialProviders?.google) }));

  app.on(["POST", "GET"], "/api/auth/*", (c) => getAuth().handler(c.req.raw));

  app.route("/api/tables", tablesRoute);
  app.route("/api", rowsRoute);
  app.route("/api", columnsRoute);
  app.route("/api/chat", createChatRoute());
  app.route("/api/threads", threadsRoute);
  app.route("/api/members", membersRoute);
  app.route("/api/commands", commandsRoute);
  app.route("/api", automationsRoute);
  app.route("/api/reports", reportsRoute);
  app.route("/api/sites", sitesRoute);
  app.route("/api/skills", skillsRoute);
  app.route("/api", filesRoute);
  app.route("/api/user/api-keys", apiKeysRoute);
  app.route("/api/site-keys", siteKeysRoute);
  app.route("/api/integrations", integrationsRoute);
  app.route("/api/webhook-endpoints", webhookEndpointsRoute);
  app.route("/api/webhooks", webhooksRoute);

  app.onError((err, c) => {
    if ("getResponse" in err && typeof err.getResponse === "function") return err.getResponse();
    console.error(err);
    if (err.name === "ZodError") {
      return c.json({ error: "参数错误", details: err }, 400);
    }
    const msg = err.message || "服务器错误";
    if (msg.includes("版本冲突")) {
      return c.json({ error: msg }, 409);
    }
    return c.json({ error: msg }, 500);
  });

  return app;
}
