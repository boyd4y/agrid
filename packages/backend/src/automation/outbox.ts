import type { PlatformDatabase } from "../db/factory.js";
import { sql } from "drizzle-orm";
import { automationDeliveryId, parseAutomationDelivery, type AutomationDelivery } from "@tabdo/shared";
import type { QueuePublisher } from "@tabdo/core/queue";

export type OutboxDelivery = { id: string; payload: AutomationDelivery; generation: number; claim_token: string; attempts: number };

export type OutboxRelayDependencies = Readonly<{
  database: PlatformDatabase;
  uuid(): string;
  publisher: QueuePublisher<AutomationDelivery>;
  batchSize: number;
  leaseMs: number;
  concurrency: number;
  logger?: Readonly<{ error(event: string, recordId: string, error: string): void }>;
}>;

/** Application outbox policy. Queue providers only publish the generic message envelope. */
export function createRelay(dependencies: OutboxRelayDependencies) {
  const deps = Object.freeze({ ...dependencies });
  for (const key of ["batchSize", "leaseMs", "concurrency"] as const) {
    if (!Number.isSafeInteger(deps[key]) || deps[key] < 1) throw new Error(`Invalid outbox relay ${key}`);
  }
  const publisher = deps.publisher;
  return {
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
    /** No database transaction or row lock is held while contacting the queue provider. */
    async publish(record: OutboxDelivery) {
      const owned = await deps.database.execute(sql`UPDATE automation_outbox
        SET claim_until = now() + ${deps.leaseMs} * interval '1 millisecond'
        WHERE id = ${record.id}::uuid AND status = 'publishing'
          AND claim_token = ${record.claim_token}::uuid AND generation = ${record.generation}
          AND claim_until > now() RETURNING id`);
      if (!owned.length) return false;
      try {
        const body = parseAutomationDelivery(record.payload);
        await publisher.publish({ id: automationDeliveryId(body), body });
        await deps.database.execute(sql`UPDATE automation_outbox
          SET status = 'published', published_at = now(), claim_token = NULL, claim_until = NULL, last_error = NULL
          WHERE id = ${record.id}::uuid AND status = 'publishing'
            AND claim_token = ${record.claim_token}::uuid AND generation = ${record.generation}`);
        return true;
      } catch (cause) {
        await publisher.close?.().catch(() => {});
        const error = cause instanceof Error ? cause.message : String(cause);
        const delay = Math.min(60000, 1000 * 2 ** Math.min(record.attempts - 1, 6));
        await deps.database.execute(sql`UPDATE automation_outbox
          SET status = 'pending', claim_token = NULL, claim_until = NULL, last_error = ${error},
            available_at = now() + ${delay} * interval '1 millisecond'
          WHERE id = ${record.id}::uuid AND status = 'publishing'
            AND claim_token = ${record.claim_token}::uuid AND generation = ${record.generation}`);
        try { deps.logger?.error("relay:publish", record.id, error); } catch { /* Observation cannot change delivery compensation. */ }
        return false;
      }
    },
    async tick() {
      const records = await this.claim();
      let cursor = 0; let sent = 0;
      const results = await Promise.allSettled(Array.from({ length: Math.min(records.length, deps.concurrency) }, async () => {
        while (cursor < records.length) {
          const record = records[cursor++];
          if (await this.publish(record)) sent++;
        }
      }));
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      return sent;
    },
    async close() { await publisher.close?.(); },
  };
}
