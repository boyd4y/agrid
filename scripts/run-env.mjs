import { spawn } from "node:child_process";
import { loadEnvironment } from "./environment.mjs";

const [mode, command, ...args] = process.argv.slice(2);
try {
  if (!command) throw new Error("Usage: node scripts/run-env.mjs development|production <command> [args...]");
  // Explicit commands determine the environment, even in a shell exporting NODE_ENV.
  process.env.NODE_ENV = mode;
  loadEnvironment({ mode });
  console.log(`[env] ${mode}${mode === "development" ? " (local PostgreSQL, Redis, and files)" : ""}`);
  const child = spawn(command, args, { stdio: "inherit", env: process.env });
  child.on("error", error => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGINT" || signal === "SIGTERM" ? 0 : 1); });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => { child.kill(signal); });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
