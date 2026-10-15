import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { superviseApi } from "./dev-supervisor.js";
import "./load-env.js";
// Development supervisor only. Production API and workers have separate entrypoints.
const cli = createRequire(import.meta.url).resolve("tsx/cli");
const cwd = process.cwd();
let closing = false;
const api = superviseApi({ entry: "src/index.ts", cwd, watchPaths: [resolve(cwd, "src"), resolve(cwd, "../../packages/shared/src"), resolve(cwd, "../../packages/queue/src"), resolve(cwd, "../../packages/storage/src"), resolve(cwd, "../../packages/agent-runtime/src"), resolve(cwd, "../../packages/core/src"), resolve(cwd, "../../packages/auth/src"), resolve(cwd, "../../packages/db/src")],
  env: { ...process.env, DB_POOL_MAX: process.env.DB_POOL_MAX ?? "10" },
  onFailure: (code) => { process.exitCode = code; void shutdown(); },
});
const worker = process.argv.includes("--api-only") ? undefined : spawn(process.execPath, [cli, "watch", "--conditions=development",
  "--include", "../../packages/shared/src/**/*.ts", "--include", "../../packages/queue/src/**/*.ts", "--include", "../../packages/storage/src/**/*.ts", "--include", "../../packages/agent-runtime/src/**/*.ts", "--include", "../../packages/core/src/**/*.ts", "--include", "../../packages/auth/src/**/*.ts", "--include", "../../packages/db/src/**/*.ts", "src/queue/main.ts"], { stdio: "inherit", env: { ...process.env, DB_POOL_MAX: "4" } });
async function shutdown() {
  if (closing) return; closing = true;
  const workerStopped = worker && worker.exitCode === null && worker.signalCode === null
    ? new Promise<void>((resolve) => { worker.once("exit", () => resolve()); worker.kill("SIGTERM"); }) : Promise.resolve();
  await Promise.all([api.shutdown(), workerStopped]);
}
process.on("SIGTERM", () => void shutdown()); process.on("SIGINT", () => void shutdown());
worker?.on("exit", (code) => { if (!closing) { process.exitCode = code || 1; void shutdown(); } });
