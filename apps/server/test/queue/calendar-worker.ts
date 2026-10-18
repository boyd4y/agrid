import assert from "node:assert/strict";
import { withNodeResources } from "../../src/resources/node.js";
import { startAutomationWorker } from "../../src/automation/jobs/workers.js";
import { client } from "../../src/db/index.js";
assert(new URL(process.env.DATABASE_URL!).pathname.endsWith("_queue_test"));
assert(process.env.QUEUE_PREFIX?.startsWith("agrid-queue-test-"));
if (process.env.HERDR_TEAM_REDIS_PREFIX) assert.equal(process.env.QUEUE_PREFIX, process.env.HERDR_TEAM_REDIS_PREFIX);
await withNodeResources(async () => {
  let blocked = false;
  const gate = async (phase: string, eventId: string) => {
    if (!blocked && eventId === process.env.FAULT_EVENT_ID && process.env.FAULT_PHASE === phase) {
      blocked = true; console.log(`CALENDAR_FAULT_${phase}`); await new Promise(() => {});
    }
  };
  const worker = startAutomationWorker({ beforeAction: id => gate("BEFORE", id), afterAction: id => gate("AFTER", id) });
  await worker.ready; console.log("CALENDAR_WORKER_READY");
  process.on("SIGTERM", () => void (async () => { await worker.close(); await client.end(); process.exit(0); })());
});
