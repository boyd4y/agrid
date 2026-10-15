import { sql } from "drizzle-orm";
import type { TaskLease } from "@tabdo/queue";
import type { ServerDatabase } from "../db/factory.js";

type Candidate = { id: string; event_id: string; generation: number; organization_id: string; row_id: string | null; claim_token: string };
export function createRecoveryStore(deps: {
  database: ServerDatabase; uuid(): string; staleMs: number; batchSize: number; queueName: string;
}) {
  return {
    async claim(): Promise<Candidate[]> {
      const token = deps.uuid();
      const staleMs = deps.staleMs;
      const records = await deps.database.execute(sql`
        WITH candidates AS (
          SELECT o.id FROM automation_outbox o
          JOIN automation_events e ON e.id = o.event_id AND e.generation = o.generation
          WHERE o.status = 'published' AND o.queue = ${deps.queueName}
            AND o.published_at < now() - ${staleMs} * interval '1 millisecond'
            AND (o.claim_until IS NULL OR o.claim_until <= now())
            AND e.finished_at IS NULL AND e.status IN ('matched', 'retrying')
            AND NOT EXISTS (SELECT 1 FROM automation_runs r WHERE r.event_id = e.id
              AND r.status IN ('unknown', 'waiting_input'))
          ORDER BY o.claim_until NULLS FIRST, o.published_at, o.id
          LIMIT ${deps.batchSize} FOR UPDATE OF o SKIP LOCKED
        )
        UPDATE automation_outbox o SET claim_token = ${token}::uuid,
          claim_until = now() + ${staleMs} * interval '1 millisecond'
        FROM candidates c, automation_events e WHERE o.id = c.id AND e.id = o.event_id
        RETURNING o.id, o.event_id, o.generation, e.organization_id, e.row_id, o.claim_token
      `) as unknown as Candidate[];
      return records;
    },
    async recover(record: Candidate, lease: TaskLease) {
      return deps.database.transaction(async (tx) => {
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
            AND status = 'published' AND claim_token = ${record.claim_token}::uuid AND claim_until > now()
          RETURNING id`);
        return reset.length;
      });
    },
  };
}
