import type { ServerDatabase } from "../db/factory.js";
import { sql } from "drizzle-orm";
import { automationDeliveryId, parseAutomationDelivery, type AutomationDelivery } from "@tabdo/shared";
import type { QueuePublisher } from "@tabdo/queue";
import { createOutboxRelay } from "@tabdo/worker/outbox";

export type OutboxDelivery = { id: string; payload: AutomationDelivery; generation: number; claim_token: string; attempts: number };

export type OutboxRelayDependencies = Readonly<{
  database: ServerDatabase;
  uuid(): string;
  publisher: QueuePublisher<AutomationDelivery>;
  batchSize: number;
  leaseMs: number;
  concurrency: number;
  logger?: Readonly<{ error(event: string, recordId: string, error: string): void }>;
}>;

/** Product SQL/fences stay here; worker owns publication, batching and compensation policy. */
export function createRelay(dependencies: OutboxRelayDependencies) {
  const deps = Object.freeze({ ...dependencies });
  for (const key of ["batchSize", "leaseMs", "concurrency"] as const) {
    if (!Number.isSafeInteger(deps[key]) || deps[key] < 1) throw new Error(`Invalid outbox relay ${key}`);
  }
  const store = {
    /** One SQL statement atomically selects AND claims rows; concurrent relays skip locks. */
    async claim(limit = deps.batchSize): Promise<OutboxDelivery[]> {
      const token = deps.uuid();
      const result = await deps.database.execute(sql`
        WITH pending AS (
          SELECT id, available_at AS due_at FROM automation_outbox
          WHERE status = 'pending' AND available_at <= now()
          ORDER BY available_at, id LIMIT ${limit} FOR UPDATE SKIP LOCKED
        ), expired AS (
          SELECT id, claim_until AS due_at FROM automation_outbox
          WHERE status = 'publishing' AND claim_until <= now()
          ORDER BY claim_until, id LIMIT ${limit} FOR UPDATE SKIP LOCKED
        ), candidates AS (
          SELECT id FROM (SELECT * FROM pending UNION ALL SELECT * FROM expired) due
          ORDER BY due_at, id LIMIT ${limit}
        )
        UPDATE automation_outbox o SET status = 'publishing', claim_token = ${token}::uuid,
          claim_until = now() + ${deps.leaseMs} * interval '1 millisecond',
          attempts = o.attempts + 1
        FROM candidates c WHERE o.id = c.id
        RETURNING o.id, o.payload, o.generation, o.claim_token, o.attempts
      `);
      return result as unknown as OutboxDelivery[];
    },
    async renew(record: OutboxDelivery) {
      const owned = await deps.database.execute(sql`UPDATE automation_outbox
        SET claim_until = now() + ${deps.leaseMs} * interval '1 millisecond'
        WHERE id = ${record.id}::uuid AND status = 'publishing'
          AND claim_token = ${record.claim_token}::uuid AND generation = ${record.generation}
          AND claim_until > now() RETURNING id`);
      return owned.length > 0;
    },
    async markPublished(record: OutboxDelivery) {
      await deps.database.execute(sql`UPDATE automation_outbox
        SET status = 'published', published_at = now(), claim_token = NULL, claim_until = NULL, last_error = NULL
        WHERE id = ${record.id}::uuid AND status = 'publishing'
          AND claim_token = ${record.claim_token}::uuid AND generation = ${record.generation}`);
    },
    async markFailed(record: OutboxDelivery, error: string, delay: number) {
      await deps.database.execute(sql`UPDATE automation_outbox
        SET status = 'pending', claim_token = NULL, claim_until = NULL, last_error = ${error},
          available_at = now() + ${delay} * interval '1 millisecond'
        WHERE id = ${record.id}::uuid AND status = 'publishing'
          AND claim_token = ${record.claim_token}::uuid AND generation = ${record.generation}`);
    },
  };
  return createOutboxRelay({
    store, publisher: deps.publisher, batchSize: deps.batchSize, concurrency: deps.concurrency,
    message(record) {
      const body = parseAutomationDelivery(record.payload);
      return { id: automationDeliveryId(body), body };
    },
    onError: (record, error) => deps.logger?.error("relay:publish", record.id, error),
  });
}
