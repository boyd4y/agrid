import "./load-env.js";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { listHarnesses } from "./ai/model.js";
import { client } from "./db/index.js";
import { assertSchemaReady } from "./db/schema-ready.js";
import { activeNativeRunCount, beginNativeDrain, waitForNativeDrain } from "./harness/drain.js";
import { createNodeHttpResources, withNodeResources } from "./resources/node.js";
import { createNodeExecution } from "./node-execution.js";

const execution = createNodeExecution(process.env);
const app = createApp({ appUrl: process.env.APP_URL || "http://localhost:5173", resources: await createNodeHttpResources(), streamNativeRun: execution.stream });
const port = Number(process.env.PORT ?? 3001);
await withNodeResources(assertSchemaReady);
execution.start();
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
  execution.stopDispatch();
  console.log(`[api] stopping after ${activeNativeRunCount()} native Run(s) have saved`);
  shutdown = (async () => {
    const connectionsClosed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if ("closeIdleConnections" in server) server.closeIdleConnections();
    await Promise.all([waitForNativeDrain(), connectionsClosed]);
    await execution.close();
    await client.end();
    if (process.connected) process.disconnect();
  })().catch((error) => { console.error("[api] shutdown failed", error); process.exitCode = 1; });
  return shutdown;
}
process.on("SIGTERM", () => void drainAndStop());
process.on("SIGINT", () => void drainAndStop());
