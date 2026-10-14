import { client } from "../db/index.js";
import { startWorker } from "./workers.js";
import { createRelay } from "./relay.js";
import { positiveInt } from "./config.js";
import { dispatchDueSchedules } from "../automation/schedule.js";
import { reconcileNativeAutomations } from "../automation/execution.js";
import { createPublishedReconciler } from "./reconcile.js";
const reconciler = createPublishedReconciler();
const relay = createRelay();
const runtime = startWorker();
let closing = false;
const loop = (async () => {
  while (!closing) {
    try { await dispatchDueSchedules(); await reconcileNativeAutomations(); await relay.tick(); } catch (error) { console.error("[relay]", error); }
    try { await reconciler.tick(); } catch (error) { console.error("[queue:reconcile]", error); }
    if (!closing) await new Promise((resolve) => setTimeout(resolve, positiveInt("AUTOMATION_RELAY_POLL_MS", 500)));
  }
})();
async function shutdown() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => { console.error("[queue] shutdown deadline; delivery leases and BullMQ recover unfinished work"); process.exit(1); }, positiveInt("WORKER_SHUTDOWN_MS", 20000));
  try { await Promise.all([loop.then(async () => { await relay.close(); await reconciler.close(); }), runtime.close()]); await client.end(); clearTimeout(deadline); process.exit(0); }
  catch (error) { console.error(error); process.exit(1); }
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
await runtime.ready;
console.log("[queue] started automation");
