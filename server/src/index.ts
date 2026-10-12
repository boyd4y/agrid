import "./load-env.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { tablesRoute } from "./routes/tables.js";
import { rowsRoute } from "./routes/rows.js";
import { columnsRoute } from "./routes/columns.js";
import { chatRoute } from "./routes/chat.js";
import { membersRoute } from "./routes/members.js";
import { commandsRoute } from "./routes/commands.js";
import { automationsRoute } from "./routes/automations.js";
import { auth } from "./auth/index.js";
import { listHarnesses } from "./ai/model.js";

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
  const msg = err.message || "服务器错误";
  if (msg.includes("版本冲突")) {
    return c.json({ error: msg }, 409);
  }
  return c.json({ error: msg }, 500);
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
