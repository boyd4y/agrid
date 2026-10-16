import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { startWorkerService } from "../src/runtime.js";
import { signal } from "./fixtures.js";

test("polling isolates task/logger failures, never overlaps and interrupts idle before ordered/repeated cleanup", async () => {
  const entered = signal(), finish = signal(), second = signal();
  const events: string[] = []; let runs = 0;
  const service = startWorkerService({ intervalMs: 5,
    worker: { ready: Promise.resolve(), async close() { events.push("consumer-close"); } },
    tasks: [
      { name: "broken", async run() { throw new Error("broken scan"); } },
      { name: "reports", async run() { runs++; entered.resolve(); await finish.promise; second.resolve(); } },
    ],
    resources: [{ async close() { events.push("store-close"); } }],
    onError() { events.push("error"); throw new Error("broken logger"); },
  });
  await entered.promise;
  await new Promise((resolve) => setTimeout(resolve, 20)); assert.equal(runs, 1);
  const close = service.close(); assert.equal(close, service.close());
  assert(!events.includes("store-close"));
  finish.resolve(); await second.promise; await close;
  assert.equal(runs, 1); assert.equal(events.at(-1), "store-close");
  assert(events.includes("error"));
  const idle = startWorkerService({ worker: { ready: Promise.resolve(), async close() {} }, tasks: [], intervalMs: 60000 });
  await idle.ready; await new Promise((resolve) => setTimeout(resolve, 10));
  const began = Date.now(); await idle.close(); assert(Date.now() - began < 500);
});

test("failed startup closes every owned resource even if one cleanup fails", async () => {
  let cleaned = 0;
  const service = startWorkerService({ intervalMs: 10, tasks: [],
    worker: { ready: Promise.reject(new Error("startup refused")), async close() { throw new Error("close refused"); } },
    resources: [{ async close() { cleaned++; } }, { async close() { cleaned++; } }],
  });
  await assert.rejects(service.ready, /startup refused/);
  await assert.rejects(service.close(), /failed to close/); assert.equal(cleaned, 2);
});

test("Node host drains on SIGTERM, handles SIGINT during startup and enforces shutdown deadlines", { timeout: 10000 }, async () => {
  const entry = new URL("../src/node.ts", import.meta.url).href;
  for (const mode of ["drain", "starting", "timeout"] as const) {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { runWorkerProcess } from ${JSON.stringify(entry)};
      const mode = ${JSON.stringify(mode)};
      setInterval(() => {}, 1000);
      await runWorkerProcess({ shutdownTimeoutMs: 100,
        start: () => {
          // The host installs signal handlers before calling start; ready may still be pending.
          console.log('HOST_CREATED');
          return { ready: mode === 'starting' ? new Promise(() => {}) : Promise.resolve(),
            async close() { if (mode === 'timeout') await new Promise(() => {}); console.log('DRAINED'); } };
        },
        onReady() { console.log('READY'); }, onError(e) { console.log(e.message); }
      });
    `], { stdio: ["ignore", "pipe", "pipe"], timeout: 3000, killSignal: "SIGKILL" });
    let output = "", signaled = false;
    child.stdout.on("data", (bytes) => {
      output += String(bytes);
      if (!signaled && output.includes(mode === "starting" ? "HOST_CREATED" : "READY")) {
        signaled = true;
        child.kill(mode === "starting" ? "SIGINT" : "SIGTERM");
      }
    });
    child.stderr.on("data", (bytes) => { output += String(bytes); });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    try {
      assert.deepEqual(await exited, { code: mode === "timeout" ? 1 : 0, signal: null }, output);
      assert(signaled, output);
      if (mode === "starting") assert(!output.includes("READY"), output);
      assert(output.includes(mode === "timeout" ? "deadline exceeded" : "DRAINED"), output);
    } finally { child.kill("SIGKILL"); }
  }
});
