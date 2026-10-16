import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const server = fileURLToPath(new URL("../apps/server/", import.meta.url));
for (const path of ["../apps/server/dist/index.js", "../apps/server/dist/queue/main.js", "../apps/client/dist/index.html"]) {
  try { await access(new URL(path, import.meta.url)); }
  catch { throw new Error("Missing built application. Run pnpm local:setup before pnpm local:start."); }
}
const env = {
  ...process.env,
  NODE_ENV: "production",
  TABDO_ENV: "development",
  PORT: "3301",
  HOST: "127.0.0.1",
  APP_URL: "http://localhost:3301",
  BETTER_AUTH_URL: "http://localhost:3301",
  CLIENT_DIST_PATH: fileURLToPath(new URL("../apps/client/dist", import.meta.url)),
};
let closing = false;
const processes = [
  spawn(process.execPath, ["dist/index.js"], { cwd: server, env, stdio: "inherit" }),
  spawn(process.execPath, ["dist/queue/main.js"], { cwd: server, env: { ...env, DB_POOL_MAX: "4" }, stdio: "inherit" }),
];
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  process.exitCode = code;
  await Promise.all(processes.map(child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    return new Promise(resolve => {
      child.once("close", resolve);
      child.kill("SIGTERM");
    });
  }));
}
for (const child of processes) {
  child.on("error", error => { console.error(error.message); void shutdown(1); });
  child.on("exit", code => { if (!closing) void shutdown(code || 1); });
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
