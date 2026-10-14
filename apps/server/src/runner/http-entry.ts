import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createNodeProcessExecution } from "@tabdo/execution/adapters/node-process";
import { nodeJobResources } from "../resources/node.js";
import { createNativeExecutionHttpHost } from "./http-host.js";

const secret = process.env.INTERNAL_EXECUTION_SECRET ?? "";
if (secret.length < 32) throw new Error("INTERNAL_EXECUTION_SECRET must contain at least 32 characters");
const port = Number(process.env.RUNNER_PORT ?? 3002);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid RUNNER_PORT");
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
env.DB_POOL_MAX = process.env.RUNNER_DB_POOL_MAX ?? "2";
const executor = createNodeProcessExecution({ executable: process.execPath,
  args: [process.env.RUNNER_ENTRY_PATH ?? fileURLToPath(new URL("./node-entry.js", import.meta.url))],
  cwd: process.cwd(), env });
const fetch = createNativeExecutionHttpHost({ executor,
  authentication: { secret, audience: process.env.INTERNAL_EXECUTION_AUDIENCE ?? "tabdo-agent-runner" } });
const server = serve({ fetch, port });
let stopping = false;
const stop = async () => {
  if (stopping) return;stopping = true;
  await new Promise<void>(resolve => server.close(() => resolve()));
  await executor.close();await nodeJobResources.database.close();
};
process.once("SIGTERM", () => { void stop(); });
process.once("SIGINT", () => { void stop(); });
