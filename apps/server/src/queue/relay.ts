import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { positiveInt } from "./config.js";
import { createQueue, closeQueue, jobId, type AutomationJob } from "./queues.js";

type Delivery = { id: string; payload: AutomationJob; generation: number; claim_token: string; attempts: number };

export function createRelay() {
  let producer: ReturnType<typeof createQueue> | undefined;
  return {
    /** One SQL statement atomically selects AND claims rows; concurrent relays skip locks. */
    async claim(limit = positiveInt("AUTOMATION_RELAY_BATCH", 25)): Promise<Delivery[]> {
      const token = randomUUID();
      const result = await db.execute(sql`
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
    /** No database transaction or row lock is held while contacting Redis. */
    async publish(record: Delivery) {
      const owned = await db.execute(sql`UPDATE automation_outbox
        SET claim_until = now() + ${positiveInt("AUTOMATION_RELAY_LEASE_MS", 30000)} * interval '1 millisecond'
        WHERE id = ${record.id}::uuid AND status = 'publishing'
          AND claim_token = ${record.claim_token}::uuid AND generation = ${record.generation}
          AND claim_until > now() RETURNING id`);
      if (!owned.length) return false;
      const queue = producer ??= createQueue();
      try {
        await queue.add("execute", record.payload, { jobId: jobId(record.payload.eventId, record.generation) });
        await db.execute(sql`UPDATE automation_outbox
          SET status = 'published', published_at = now(), claim_token = NULL, claim_until = NULL, last_error = NULL
          WHERE id = ${record.id}::uuid AND status = 'publishing'
            AND claim_token = ${record.claim_token}::uuid AND generation = ${record.generation}`);
        return true;
      } catch (cause) {
        if (producer === queue) producer = undefined;
        await closeQueue(queue).catch(() => {});
        const error = cause instanceof Error ? cause.message : String(cause);
        const delay = Math.min(60000, 1000 * 2 ** Math.min(record.attempts - 1, 6));
        await db.execute(sql`UPDATE automation_outbox
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
    async close() { if (producer) await closeQueue(producer); },
  };
}
