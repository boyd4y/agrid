import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { reconcileStaleMs, reconcileBatch, queueName } from "./config.js";
import { acquireRowLease, createLeaseClient } from "./lease.js";
import { closeQueue, createQueue, jobId } from "./queues.js";

type Candidate = { id: string; event_id: string; generation: number; organization_id: string; row_id: string | null };

/** Recover missing deliveries only; never infer that a running/native action is safe to replay. */
export function createPublishedReconciler() {
  let queue: ReturnType<typeof createQueue> | undefined;
  let leases: ReturnType<typeof createLeaseClient> | undefined;
  return {
    async tick() {
      const token = randomUUID();
      const staleMs = reconcileStaleMs;
      const records = await db.execute(sql`
        WITH candidates AS (
          SELECT o.id FROM automation_outbox o
          JOIN automation_events e ON e.id = o.event_id AND e.generation = o.generation
          WHERE o.status = 'published' AND o.queue = ${queueName}
            AND o.published_at < now() - ${staleMs} * interval '1 millisecond'
            AND (o.claim_until IS NULL OR o.claim_until <= now())
            AND e.finished_at IS NULL AND e.status IN ('matched', 'retrying')
            AND NOT EXISTS (SELECT 1 FROM automation_runs r WHERE r.event_id = e.id
              AND r.status IN ('unknown', 'waiting_input'))
          ORDER BY o.claim_until NULLS FIRST, o.published_at, o.id
          LIMIT ${reconcileBatch} FOR UPDATE OF o SKIP LOCKED
        )
        UPDATE automation_outbox o SET claim_token = ${token}::uuid,
          claim_until = now() + ${staleMs} * interval '1 millisecond'
        FROM candidates c, automation_events e WHERE o.id = c.id AND e.id = o.event_id
        RETURNING o.id, o.event_id, o.generation, e.organization_id, e.row_id
      `) as unknown as Candidate[];
      let recovered = 0;
      for (const record of records) {
        const producer = queue ??= createQueue();
        const client = leases ??= createLeaseClient();
        // All extant states, including retained terminal jobs, are deliberately left alone.
        try {
          if (await producer.getJob(jobId(record.event_id, record.generation))) continue;
        } catch (error) {
          if (queue === producer) queue = undefined;
          await closeQueue(producer).catch(() => {});
          throw error;
        }
        const lease = await acquireRowLease(client, record.organization_id, record.row_id ?? record.event_id);
        if (!lease) continue;
        try {
          recovered += await db.transaction(async (tx) => {
            // Serialize with claimExecution, completion and manual replay before changing delivery.
            const events = await tx.execute(sql`SELECT e.id FROM automation_events e
              WHERE e.id = ${record.event_id}::uuid AND generation = ${record.generation}
                AND finished_at IS NULL AND status IN ('matched', 'retrying')
                AND NOT EXISTS (SELECT 1 FROM automation_runs r WHERE r.event_id = e.id
                  AND r.status IN ('unknown', 'waiting_input')) FOR UPDATE`);
            if (!events.length) return 0;
            await lease.assertOwned();
            const reset = await tx.execute(sql`UPDATE automation_outbox
              SET status = 'pending', published_at = NULL, claim_token = NULL, claim_until = NULL,
                available_at = now(), last_error = NULL
              WHERE id = ${record.id}::uuid AND generation = ${record.generation}
                AND status = 'published' AND claim_token = ${token}::uuid AND claim_until > now()
              RETURNING id`);
            return reset.length;
          });
        } finally { await lease.release(); }
      }
      // Claims on skipped rows expire as a cooldown, so healthy jobs cannot starve later batches.
      return recovered;
    },
    async close() {
      try { if (queue) await closeQueue(queue); }
      finally { leases?.disconnect(); }
    },
  };
}
