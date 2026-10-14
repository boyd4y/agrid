import { and,asc,eq,inArray } from "drizzle-orm";
import type { QueuePublisher } from "@tabdo/core/queue";
import { agentExecutions,agentRuns } from "@tabdo/backend/schema";
import { dispatchDueSchedules } from "@tabdo/backend/automation/schedule";
import { createRelay } from "@tabdo/backend/automation/outbox";
import type { AcquireProductScope } from "./product-scope.js";
import { executionJob,type ProductJob } from "./queue.js";

/** SQL occurrences and outbox claims make duplicate Cron deliveries safe. */
export function createProductScheduledHandler<Env>(options: Readonly<{
  acquire: AcquireProductScope<Env>;
  publisher(env: Env): QueuePublisher<ProductJob>;
}>) {
  return async (event: Readonly<{ scheduledTime: number; cron: string }>,env: Env) => {
    if (!Number.isSafeInteger(event.scheduledTime) || event.scheduledTime < 0) throw new TypeError("Invalid platform schedule time");
    const scope = await options.acquire(env);
    try {
      await dispatchDueSchedules(scope.commands,new Date(event.scheduledTime));
      const publisher = options.publisher(env);
      const relay = createRelay({ database: scope.runtime.database,uuid: scope.runtime.uuid,publisher,
        batchSize: 25,leaseMs: 30000,concurrency: 8,logger: { error: (_event,id) => console.warn("queue.outbox.pending",id) } });
      await relay.tick();
      // Durable acceptance survives an HTTP/queue publication failure. Wake only
      // receipts that have never crossed the PG invocation fence.
      const pending = await scope.runtime.database.select({ id: agentExecutions.id }).from(agentExecutions)
        .innerJoin(agentRuns,eq(agentRuns.id,agentExecutions.runId))
        .where(and(eq(agentExecutions.status,"accepted"),inArray(agentRuns.status,["starting","running"])))
        .orderBy(asc(agentExecutions.acceptedAt)).limit(32);
      const results = await Promise.allSettled(pending.map(execution => publisher.publish(executionJob(execution.id))));
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    } finally { await scope.close(); }
  };
}
