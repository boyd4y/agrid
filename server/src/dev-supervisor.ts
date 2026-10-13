import { spawn, type ChildProcess } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";

/** Coalesce source edits; a live native Run finishes and persists before reloading. */
export function superviseApi(options: { entry: string; cwd: string; watchPaths: string[]; env: NodeJS.ProcessEnv; onFailure?: (code: number) => void }) {
  let child: ChildProcess | undefined;
  let active = 0, pending = false, restarting = false, closing = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const watchers: FSWatcher[] = [];
  const start = () => {
    active = 0;
    child = spawn(process.execPath, ["--import", "tsx", "--conditions=development", options.entry], {
      cwd: options.cwd, env: options.env, stdio: ["inherit", "inherit", "inherit", "ipc"],
    });
    child.on("message", (message) => {
      if (!message || typeof message !== "object" || !("type" in message) || message.type !== "tabdo:native-runs" || !("count" in message) || !Number.isInteger(message.count) || Number(message.count) < 0) return;
      active = Number(message.count);
      if (!active && pending) reload();
    });
    child.once("exit", (code) => {
      child = undefined;
      if (closing) return;
      if (restarting) { restarting = false; pending = false; start(); }
      else options.onFailure?.(code || 1);
    });
    child.once("error", (error) => { console.error("[dev:api]", error); options.onFailure?.(1); });
  };
  const reload = () => {
    if (closing || restarting || !pending || !child) return;
    if (active) { console.log(`[dev:api] source changed; waiting for ${active} native Run(s) to save`); return; }
    restarting = true;
    console.log("[dev:api] reloading after native Runs have saved");
    // No deadline or repeated-change SIGKILL: index.ts drains work and connections.
    child.kill("SIGTERM");
  };
  const changed = () => {
    if (closing) return;
    pending = true;
    clearTimeout(debounce);
    debounce = setTimeout(reload, 150);
  };
  for (const path of options.watchPaths) watchers.push(watch(path, { recursive: true }, changed));
  start();
  return {
    sourceChanged: changed,
    shutdown: async () => {
      closing = true; clearTimeout(debounce); for (const watcher of watchers) watcher.close();
      const running = child;
      if (!running || running.exitCode !== null || running.signalCode !== null) return;
      await new Promise<void>((resolve) => { running.once("exit", () => resolve()); running.kill("SIGTERM"); });
    },
  };
}
