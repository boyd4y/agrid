import { runWorkerProcess } from "@tabdo/worker/node";
import { withNodeResources } from "../resources/node.js";
import { createAutomationService } from "../automation/jobs/service.js";
import { positiveInt } from "../automation/jobs/config.js";

await withNodeResources(() => runWorkerProcess({
  start: createAutomationService,
  shutdownTimeoutMs: positiveInt("WORKER_SHUTDOWN_MS", 20000),
  onReady: () => console.log("[queue] started automation"),
}));
