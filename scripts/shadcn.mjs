import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const uiWorkspace = args[0] === "--workspace=ui";
if (uiWorkspace) args.shift();
const workspace = uiWorkspace ? "packages/ui" : "apps/client";
if (!args.some(arg => arg === "--cwd" || arg === "-c" || arg.startsWith("--cwd="))) {
  args.push("--cwd", fileURLToPath(new URL(`../${workspace}`, import.meta.url)));
}

const env = { ...process.env };
const usesHttpProxy = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"].some(key => {
  try { return ["http:", "https:"].includes(new URL(env[key]).protocol); } catch { return false; }
});
const usesSocksProxy = ["ALL_PROXY", "all_proxy"].some(key => /^socks(?:4a?|5h?)?:\/\//i.test(env[key] ?? ""));
// @shadcn/registry 0.1.3 prioritizes SOCKS and returns an unencrypted socket
// for HTTPS. Prefer the already-configured HTTP proxy in this child only.
// Keep SOCKS-only environments and NO_PROXY intact; never invent a proxy URL.
if (usesHttpProxy && usesSocksProxy) {
  delete env.ALL_PROXY;
  delete env.all_proxy;
}

const cli = require.resolve("shadcn");
const child = spawn(process.execPath, [cli, ...args], { cwd: root, env, stdio: "inherit" });
child.on("error", error => {
  console.error(`Unable to launch shadcn: ${error.code ?? "process error"}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
