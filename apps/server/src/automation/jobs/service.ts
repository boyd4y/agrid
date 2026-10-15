import { startWorkerService } from "@tabdo/worker/runtime";
import { getDatabaseClient } from "../../resources/scope.js";
import { dispatchDueSchedules } from "../schedule.js";
import { reconcileNativeAutomations } from "../execution.js";
import { startAutomationWorker } from "./workers.js";
import { createRelay } from "./relay.js";
import { createAutomationQueue } from "./queues.js";
import { createPublishedReconciler } from "./reconcile.js";
import { positiveInt } from "./config.js";

export function createAutomationService() {
  const intervalMs = positiveInt("AUTOMATION_RELAY_POLL_MS", 500);
  const relay = createRelay(createAutomationQueue());
  const recovery = createPublishedReconciler();
  return startWorkerService({
    worker: startAutomationWorker(), intervalMs,
    tasks: [
      { name: "schedules", run: dispatchDueSchedules },
      { name: "native-actions", run: reconcileNativeAutomations },
      { name: "outbox", run: relay.tick },
      { name: "delivery-recovery", run: recovery.tick },
    ],
    resources: [relay, recovery, { close: () => getDatabaseClient().end() }],
    onError: (task, error) => console.error(`[worker:${task}]`, error),
  });
}
