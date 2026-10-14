import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDatabase } from "@tabdo/backend/resources";

import { positiveInt } from "./config.js";
import { automationDeliveryId, parseAutomationDelivery, type AutomationDelivery } from "@tabdo/shared";
import type { QueuePublisher } from "@tabdo/core/queue";

type Delivery = { id: string; payload: AutomationDelivery; generation: number; claim_token: string; attempts: number };

export function createRelay(publisher: QueuePublisher<AutomationDelivery>) {
  return {
    /** One SQL statement atomically selects AND claims rows; concurrent relays skip locks. */
    async claim(limit = positiveInt("AUTOMATION_RELAY_BATCH", 25)): Promise<Delivery[]> {
      const token = randomUUID();
      const result = await getDatabase().execute(sql`
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
          claim_until = now() + ${positiveInt("AUTOMATION_RELAY_LEASE_MS", 30000)} * interval '1 millisecond',
          attempts = o.attempts + 1
        FROM candidates c WHERE o.id = c.id
        RETURNING o.id, o.payload, o.generation, o.claim_token, o.attempts
      `);
      return result as unknown as Delivery[];
    },
    /** No database transaction or row lock is held while contacting the queue provider. */
    async publish(record: Delivery) {
      const owned = await getDatabase().execute(sql`UPDATE automation_outbox
        SET claim_until = now() + ${positiveInt("AUTOMATION_RELAY_LEASE_MS", 30000)} * interval '1 millisecond'
        WHERE id = ${record.id}::uuid AND status = 'publishing'
          AND claim_token = ${record.claim_token}::uuid AND generation = ${record.generation}
          AND claim_until > now() RETURNING id`);
      if (!owned.length) return false;
      try {
        const body = parseAutomationDelivery(record.payload);
        await publisher.publish({ id: automationDeliveryId(body), body });
        await getDatabase().execute(sql`UPDATE automation_outbox
          SET status = 'published', published_at = now(), claim_token = NULL, claim_until = NULL, last_error = NULL
          WHERE id = ${record.id}::uuid AND status = 'publishing'
            AND claim_token = ${record.claim_token}::uuid AND generation = ${record.generation}`);
        return true;
      } catch (cause) {
        await publisher.close?.().catch(() => {});
        const error = cause instanceof Error ? cause.message : String(cause);
        const delay = Math.min(60000, 1000 * 2 ** Math.min(record.attempts - 1, 6));
        await getDatabase().execute(sql`UPDATE automation_outbox
          SET status = 'pending', claim_token = NULL, claim_until = NULL, last_error = ${error},
            available_at = now() + ${delay} * interval '1 millisecond'
          WHERE id = ${record.id}::uuid AND status = 'publishing'
            AND claim_token = ${record.claim_token}::uuid AND generation = ${record.generation}`);
        console.error("[relay:publish]", record.id, error);
        return false;
      }
    },
    async tick() {
      const records = await this.claim();
      let cursor = 0; let sent = 0;
      const results = await Promise.allSettled(Array.from({ length: Math.min(records.length, 8) }, async () => {
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
