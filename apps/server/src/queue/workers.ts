import { createBullMQWorker } from "@tabdo/queue/bullmq";
import { QueueDeferredError, QueuePermanentError } from "@tabdo/queue";
import { eq } from "drizzle-orm";
import { getDatabase } from "../resources/scope.js";

import { automationEvents } from "../db/schema.js";
import { claimExecution, executeNext, recordFailure, PermanentError, FenceLostError } from "../automation/execution.js";
import { acquireRowLease, createLeaseClient } from "./lease.js";
import { redisOptions, positiveInt } from "./config.js";
import { queueConfig, type AutomationJob } from "./queues.js";

export function startWorker(hooks: { beforeAction?: (eventId: string) => Promise<void>; afterAction?: (eventId: string) => Promise<void> } = {}) {
  const leases = createLeaseClient();
  const runtime = createBullMQWorker<AutomationJob>({
    ...queueConfig(), workerConnection: redisOptions(true),
    concurrency: positiveInt("WORKER_CONCURRENCY", 8),
    globalConcurrency: positiveInt("QUEUE_GLOBAL_CONCURRENCY", 32),
    lockDuration: positiveInt("WORKER_LOCK_MS", 30000),
    stalledInterval: positiveInt("WORKER_STALLED_MS", 30000),
    onError: (e) => console.error("[worker]", e.message),
    async process(job) {
      const { protocol, eventId, generation } = job.body;
      if (protocol !== 1 || typeof eventId !== "string" || !Number.isSafeInteger(generation) || generation < 0) {
        throw new QueuePermanentError("Invalid job protocol");
      }
      let fence: number | undefined;
      let lease: Awaited<ReturnType<typeof acquireRowLease>> = null;
      try {
        const [event] = await getDatabase().select().from(automationEvents).where(eq(automationEvents.id, eventId));
        if (!event || event.finishedAt || event.generation !== generation) return;
        lease = await acquireRowLease(leases, event.organizationId, event.rowId ?? event.id);
        if (!lease) {
          throw new QueueDeferredError(200 + Math.floor(Math.random() * 300));
        }
        fence = await claimExecution(eventId, generation);
        if (fence === undefined) return;
        while (true) {
          await lease.assertOwned();
          await hooks.beforeAction?.(eventId);
          if (await executeNext(eventId, fence) === "done") break;
          await hooks.afterAction?.(eventId);
        }
      } catch (cause) {
        if (cause instanceof QueueDeferredError || cause instanceof FenceLostError) throw cause;
        const error = cause instanceof Error ? cause : new Error(String(cause));
        const final = error instanceof PermanentError || job.attempt >= job.attempts;
        const [event] = await getDatabase().select().from(automationEvents).where(eq(automationEvents.id, eventId));
        if (event?.generation === generation) await recordFailure(eventId, error, final, fence, generation);
        if (final) throw new QueuePermanentError(error.message);
        throw error;
      } finally { await lease?.release(); }
    },
    async onFailed({ delivery, error, terminal }) {
      console.error("[worker] failed", delivery.id, error.message);
      if (!terminal) return;
      const { eventId, generation } = delivery.body;
      const [event] = await getDatabase().select().from(automationEvents).where(eq(automationEvents.id, eventId));
      if (event?.generation === generation) await recordFailure(event.id, error, true, undefined, generation);
    },
  });
  return { ...runtime, async close() { try { await runtime.close(); } finally { leases.disconnect(); } } };
}
