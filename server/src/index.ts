import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tablesRoute } from "./routes/tables.js";
import { rowsRoute } from "./routes/rows.js";
import { columnsRoute } from "./routes/columns.js";
import { chatRoute } from "./routes/chat.js";
import { membersRoute } from "./routes/members.js";
import { commandsRoute } from "./routes/commands.js";
import { automationsRoute } from "./routes/automations.js";
import { auth } from "./auth/index.js";
import { listHarnesses } from "./ai/model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  resolve(__dirname, "../../.env"),
  resolve(process.cwd(), "../.env"),
  resolve(process.cwd(), ".env"),
];
for (const envPath of envCandidates) {
  const result = loadEnv({ path: envPath, override: false });
  if (result.parsed && Object.keys(result.parsed).length > 0) break;
}

const app = new Hono();
const appUrl = process.env.APP_URL || "http://localhost:5173";

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: [appUrl, "http://localhost:5173", "http://127.0.0.1:5173"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS", "PUT"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "agrid",
    multiHarness: true,
    auth: true,
    notionStyle: true,
    automations: true,
  })
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/api/tables", tablesRoute);
app.route("/api", rowsRoute);
app.route("/api", columnsRoute);
app.route("/api/chat", chatRoute);
app.route("/api/members", membersRoute);
app.route("/api/commands", commandsRoute);
app.route("/api", automationsRoute);

app.onError((err, c) => {
  console.error(err);
  if (err.name === "ZodError") {
    return c.json({ error: "参数错误", details: err }, 400);
  }
  return c.json({ error: err.message || "服务器错误" }, 500);
});

const port = Number(process.env.PORT ?? 3001);
console.log(`API listening on http://localhost:${port}`);
{
  const hs = listHarnesses();
  const online = hs.filter((h) => h.available).map((h) => `${h.id}@${h.defaultModel}`);
  console.log(
    `[harness] mode=${online.length ? "live" : "mock"} online=${online.join(",") || "none"}`,
  );
}
serve({ fetch: app.fetch, port });
