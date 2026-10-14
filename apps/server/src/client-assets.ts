import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

/** Node deployment composition: serve the built SPA beside the existing API. */
export function mountClientAssets(app: Hono, directory: string) {
  const absolute = resolve(directory);
  if (!existsSync(resolve(absolute, "index.html"))) throw new Error("CLIENT_DIST_PATH must contain a built client index.html");
  // The Node static adapter requires a cwd-relative path.
  const root = relative(process.cwd(), absolute) || ".";
  app.on(["GET", "HEAD"], "*", async (c, next) => {
    if (c.req.path === "/api" || c.req.path.startsWith("/api/")) return next();
    const response = await serveStatic({ root })(c, next);
    if (response instanceof Response && response.headers.get("Content-Type")?.startsWith("text/html")) response.headers.set("Cache-Control", "no-cache");
    return response;
  });
  app.on(["GET", "HEAD"], "*", async (c, next) => {
    const path = c.req.path;
    if (path === "/api" || path.startsWith("/api/") || path.startsWith("/assets/") || path.split("/").pop()?.includes(".")) return next();
    c.header("Cache-Control", "no-cache");
    return serveStatic({ root, path: "index.html" })(c, next);
  });
}
