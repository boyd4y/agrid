import { Worker, DelayedError, UnrecoverableError } from "bullmq";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { automationEvents } from "../db/schema.js";
import { claimExecution, executeNext, recordFailure, PermanentError, FenceLostError } from "../automation/execution.js";
import { acquireRowLease, createLeaseClient } from "./lease.js";
import { queueName, prefix, redisOptions, positiveInt } from "./config.js";
import { createQueue, closeQueue, type AutomationJob } from "./queues.js";

export function startWorker(hooks: { beforeAction?: (eventId: string) => Promise<void>; afterAction?: (eventId: string) => Promise<void> } = {}) {
  const leases = createLeaseClient();
  const settings = createQueue();
  const ready = settings.setGlobalConcurrency(positiveInt("QUEUE_GLOBAL_CONCURRENCY", 32));
  const worker = new Worker<AutomationJob>(queueName, async (job, token) => {
    const { protocol, eventId, generation } = job.data;
    if (protocol !== 1 || typeof eventId !== "string" || !Number.isSafeInteger(generation) || generation < 0) {
      throw new UnrecoverableError("Invalid job protocol");
    }
    let fence: number | undefined;
    let lease: Awaited<ReturnType<typeof acquireRowLease>> = null;
    try {
      const [event] = await db.select().from(automationEvents).where(eq(automationEvents.id, eventId));
      if (!event || event.finishedAt || event.generation !== generation) return;
      lease = await acquireRowLease(leases, event.organizationId, event.rowId ?? event.id);
      if (!lease) {
        await job.moveToDelayed(Date.now() + 200 + Math.floor(Math.random() * 300), token);
        throw new DelayedError();
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
      if (cause instanceof DelayedError || cause instanceof FenceLostError) throw cause;
      const error = cause instanceof Error ? cause : new Error(String(cause));
      const final = error instanceof PermanentError || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      const [event] = await db.select().from(automationEvents).where(eq(automationEvents.id, eventId));
      if (event?.generation === generation) await recordFailure(eventId, error, final, fence, generation);
      if (final) throw new UnrecoverableError(error.message);
      throw error;
    } finally { await lease?.release(); }
  }, { prefix, connection: redisOptions(true), concurrency: positiveInt("WORKER_CONCURRENCY", 8), autorun: false,
    lockDuration: positiveInt("WORKER_LOCK_MS", 30000), stalledInterval: positiveInt("WORKER_STALLED_MS", 30000),
    maxStalledCount: 2 });
  worker.on("error", (e) => console.error("[worker]", e.message));
  worker.on("failed", (job, error) => {
    console.error("[worker] failed", job?.id, error.message);
    if (job && (error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1)
      || error.message.includes("stalled"))) void (async () => {
        const [event] = await db.select().from(automationEvents).where(eq(automationEvents.id, job.data.eventId));
        if (event?.generation === job.data.generation) await recordFailure(event.id, error, true, undefined, job.data.generation);
      })().catch((e) => console.error("[worker:failure-record]", e.message));
  });
  const started = ready.then(async () => {
    await worker.waitUntilReady();
    void worker.run().catch((e) => console.error("[worker:run]", e.message));
  });
  return { worker, ready: started, async close() { await worker.close(); await closeQueue(settings); leases.disconnect(); } };
}
