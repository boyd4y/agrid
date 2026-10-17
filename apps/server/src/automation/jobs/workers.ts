import { createTaskWorker, TaskDeferredError, TaskPermanentError } from "@tabdo/worker";
import { eq } from "drizzle-orm";
import { getDatabase } from "../../resources/scope.js";

import { automationEvents } from "../../db/schema.js";
import { claimExecution, executeNext, recordFailure, PermanentError, FenceLostError } from "../execution.js";
import { rowLeaseKeys, createRowLeaseProvider } from "./lease.js";
import { positiveInt } from "./config.js";
import { createAutomationQueue, type AutomationJob } from "./queues.js";

export function startAutomationWorker(hooks: { beforeAction?: (eventId: string) => Promise<void>; afterAction?: (eventId: string) => Promise<void> } = {}) {
  return createTaskWorker<AutomationJob>({
    queue: createAutomationQueue(), leases: createRowLeaseProvider(),
    concurrency: positiveInt("WORKER_CONCURRENCY", 8),
    globalConcurrency: positiveInt("QUEUE_GLOBAL_CONCURRENCY", 32),
    lockDuration: positiveInt("WORKER_LOCK_MS", 30000),
    stalledInterval: positiveInt("WORKER_STALLED_MS", 30000),
    async handle(job, context) {
      const { protocol, eventId, generation } = job.body;
      if ((protocol !== 1 && protocol !== 2) || typeof eventId !== "string" || !Number.isSafeInteger(generation) || generation < 0) {
        throw new TaskPermanentError("Invalid job protocol");
      }
      let fence: number | undefined;
      try {
        const [event] = await getDatabase().select().from(automationEvents).where(eq(automationEvents.id, eventId));
        if (!event || event.finishedAt || event.generation !== generation) return;
        if ((event.snapshot.protocol === 3 ? 2 : 1) !== protocol) throw new PermanentError("Automation delivery/event protocol mismatch");
        const lease = await context.acquireLease(rowLeaseKeys(event.organizationId, event.rowId ?? event.id));
        fence = await claimExecution(eventId, generation);
        if (fence === undefined) return;
        while (true) {
          await lease.assertOwned();
          await hooks.beforeAction?.(eventId);
          if (await executeNext(eventId, fence) === "done") break;
          await hooks.afterAction?.(eventId);
        }
      } catch (cause) {
        if (cause instanceof TaskDeferredError || cause instanceof FenceLostError) throw cause;
        const error = cause instanceof Error ? cause : new Error(String(cause));
        const final = error instanceof PermanentError || context.isFinalAttempt;
        const [event] = await getDatabase().select().from(automationEvents).where(eq(automationEvents.id, eventId));
        if (event?.generation === generation) await recordFailure(eventId, error, final, fence, generation);
        if (final) throw new TaskPermanentError(error.message);
        throw error;
      }
    },
    async onFailed({ delivery, error, terminal }) {
      console.error("[worker] failed", delivery.id, error.message);
      if (!terminal) return;
      const { eventId, generation } = delivery.body;
      const [event] = await getDatabase().select().from(automationEvents).where(eq(automationEvents.id, eventId));
      if (event?.generation === generation) await recordFailure(event.id, error, true, undefined, generation);
    },
  });
}
