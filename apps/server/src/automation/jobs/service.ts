import { startWorkerService, closeResources } from "@tabdo/worker/runtime";
import type { QueuePublisher, QueueTransport } from "@tabdo/queue";
import type { AutomationDelivery } from "@tabdo/shared";
import { getDatabaseClient, requirePlatformResources } from "../../resources/scope.js";
import { commandDependencies } from "../../services/dependencies.js";
import { nextOutboxDeadline, nextScheduleDeadline } from "../../business/automation/deadlines.js";
import { dispatchDueSchedules } from "../schedule.js";
import { reconcileNativeAutomations } from "../execution.js";
import { startAutomationWorker } from "./workers.js";
import { createRelay } from "./relay.js";
import { createAutomationQueue, createAutomationControlQueue, type AutomationWakeup } from "./queues.js";
import { createPublishedReconciler } from "./reconcile.js";
import { positiveInt } from "./config.js";

/** Redis drives normal work. SQL sweeps are startup/recovery only, not the clock. */
export function createAutomationService(options: {
  recoveryIntervalMs?: number;
  closeDatabase?: boolean;
  controlQueue?: QueueTransport<AutomationWakeup>;
  publisher?: QueuePublisher<AutomationDelivery>;
} = {}) {
  const intervalMs = options.recoveryIntervalMs ?? positiveInt("AUTOMATION_RECOVERY_INTERVAL_MS", 15 * 60_000);
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) throw new TypeError("Invalid recovery interval");
  const relay = createRelay(options.publisher ?? createAutomationQueue());
  const recovery = createPublishedReconciler();
  const control = options.controlQueue ?? createAutomationControlQueue();
  const deps = commandDependencies();
  let stopping = false;
  async function arm(kind: "outbox" | "schedules", deadline: Date | null) {
    if (!deadline || stopping) return;
    const at = deadline.getTime(), delayMs = Math.max(100, at - Date.now());
    // Future deadlines deduplicate across producers/replicas. Already-due batches
    // need a fresh identity because their preceding timer may still be active.
    const id = at > Date.now() ? `timer-${kind}-${at}` : crypto.randomUUID();
    await control.publish({ id, body: { kind } }, { delayMs });
  }
  async function outbox() {
    await relay.tick();
    await arm("outbox", await nextOutboxDeadline(deps));
  }
  async function schedules() {
    await dispatchDueSchedules();
    await outbox();
    await arm("schedules", await nextScheduleDeadline(deps));
  }
  async function native(threadId?: string) {
    const candidates = await reconcileNativeAutomations(25, undefined, threadId);
    await outbox();
    if (candidates === 25 && !stopping) await control.publish({ id: crypto.randomUUID(),
      body: { kind: "native-actions", ...(threadId ? { threadId } : {}) } }, { delayMs: 100 });
  }
  const execution = startAutomationWorker();
  const listener = control.consume({
    concurrency: 1, globalConcurrency: 1, lockDuration: 30_000, stalledInterval: 30_000,
    async process({ body }) {
      if (!body || !["outbox", "schedules", "native-actions"].includes(body.kind)
        || ("threadId" in body && (body.kind !== "native-actions" || typeof body.threadId !== "string"))) {
        return { type: "retry", permanent: true, error: new Error("Invalid automation wakeup") };
      }
      if (body.kind === "outbox") await outbox();
      else if (body.kind === "schedules") await schedules();
      else await native("threadId" in body ? body.threadId : undefined);
      return { type: "complete" };
    },
    onFailed({ delivery, error, terminal }) {
      console.error("[worker:wakeup]", delivery.id, terminal ? "exhausted" : "retrying", error.message);
    },
  });
  const worker = {
    ready: Promise.all([execution.ready, listener.ready]).then(() => {}),
    async close() { await closeResources([listener, execution]); },
  };
  const background = requirePlatformResources().background;
  const service = startWorkerService({
    worker, intervalMs,
    tasks: [
      { name: "schedules", run: schedules },
      { name: "native-actions", run: () => native() },
      { name: "delivery-recovery", async run() { await recovery.tick(); await outbox(); } },
    ],
    resources: [relay, recovery, control,
      { close: async () => { await background?.drain?.(); } },
      ...(options.closeDatabase === false ? [] : [{ close: () => getDatabaseClient().end() }])],
    onError: (task, error) => console.error(`[worker:${task}]`, error),
  });
  return { ready: service.ready, close() { stopping = true; return service.close(); } };
}
