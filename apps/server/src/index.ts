import "./load-env.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { tablesRoute } from "./routes/tables.js";
import { rowsRoute } from "./routes/rows.js";
import { columnsRoute } from "./routes/columns.js";
import { chatRoute } from "./routes/chat.js";
import { threadsRoute } from "./routes/threads.js";
import { membersRoute } from "./routes/members.js";
import { commandsRoute } from "./routes/commands.js";
import { automationsRoute } from "./routes/automations.js";
import { reportsRoute } from "./routes/reports.js";
import { apiKeysRoute } from "./routes/api-keys.js";
import { filesRoute } from "./routes/files.js";
import { skillsRoute } from "./routes/skills.js";
import { auth } from "./auth/index.js";
import { listHarnesses } from "./ai/model.js";
import { client } from "./db/index.js";
import { assertSchemaReady, checkSchemaReady } from "./db/schema-ready.js";
import { activeNativeRunCount, beginNativeDrain, nativeDrainStarted, registerNativeRun, waitForNativeDrain } from "./harness/drain.js";

const app = new Hono();
const appUrl = process.env.APP_URL || "http://localhost:5173";

app.use("*", logger());
app.use("/api/chat", async (c, next) => {
  if (nativeDrainStarted()) return c.json({ error: "服务正在保存当前执行，请稍后重试" }, 503);
  // Cover admission/metadata/lease waits before the detached stream takes ownership.
  const release = registerNativeRun();
  try { await next(); } finally { release(); }
});
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

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/api/tables", tablesRoute);
app.route("/api", rowsRoute);
app.route("/api", columnsRoute);
app.route("/api/chat", chatRoute);
app.route("/api/threads", threadsRoute);
app.route("/api/members", membersRoute);
app.route("/api/commands", commandsRoute);
app.route("/api", automationsRoute);
app.route("/api/reports", reportsRoute);
app.route("/api/skills", skillsRoute);
app.route("/api", filesRoute);
app.route("/api/user/api-keys", apiKeysRoute);

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

const port = Number(process.env.PORT ?? 3001);
await assertSchemaReady();
console.log(`API listening on http://localhost:${port}`);
{
  const hs = listHarnesses();
  const online = hs.filter((h) => h.available).map((h) => `${h.id}@${h.defaultModel}`);
  console.log(
    `[harness] mode=${online.length ? "live" : "unconfigured"} online=${online.join(",") || "none"}`,
  );
}
const server = serve({ fetch: app.fetch, port });
let shutdown: Promise<void> | undefined;
function drainAndStop() {
  if (shutdown) return shutdown;
  beginNativeDrain();
  console.log(`[api] stopping after ${activeNativeRunCount()} native Run(s) have saved`);
  shutdown = (async () => {
    const connectionsClosed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if ("closeIdleConnections" in server) server.closeIdleConnections();
    await Promise.all([waitForNativeDrain(), connectionsClosed]);
    await client.end();
    if (process.connected) process.disconnect();
  })().catch((error) => { console.error("[api] shutdown failed", error); process.exitCode = 1; });
  return shutdown;
}
process.on("SIGTERM", () => void drainAndStop());
process.on("SIGINT", () => void drainAndStop());
