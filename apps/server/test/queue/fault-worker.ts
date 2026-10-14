import { withNodeResources } from "../../src/resources/node.js";
// Process-level fault fixture. Never invoked by production entrypoints.
import assert from "node:assert/strict";
import { startWorker } from "../../src/queue/workers.js";
import { client } from "../../src/db/index.js";
assert.ok(new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_queue_test"));
assert.ok(process.env.QUEUE_PREFIX?.startsWith("agrid-queue-test"));
await withNodeResources(async () => {
  const runtime = startWorker({ afterAction: async (eventId) => {
    if (eventId !== process.env.FAULT_EVENT_ID) return;
    console.log("FAULT_ACTION_COMMITTED");
    if (process.argv[2] === "kill") await new Promise(() => {});
    else await new Promise((r) => setTimeout(r, 200));
  } });
  await runtime.ready; console.log("FAULT_READY");
  process.on("SIGTERM", () => void (async () => { await runtime.close(); await client.end(); process.exit(0); })());

});
