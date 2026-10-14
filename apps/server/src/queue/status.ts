import { withNodeResources } from "../resources/node.js";
import { sql } from "drizzle-orm";
import { db, client } from "../db/index.js";
import { createQueue, closeQueue } from "./queues.js";
await withNodeResources(async () => {
  const queue = createQueue();
  try {
    const outbox = await db.execute(sql`SELECT status, count(*)::int AS count,
      extract(epoch FROM now() - min(created_at))::int AS oldest_age_seconds
      FROM automation_outbox WHERE status <> 'done' GROUP BY status`);
    console.log(JSON.stringify({ outbox, queue: queue.name,
      counts: await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed"),
      globalConcurrency: await queue.getGlobalConcurrency() }, null, 2));
  } finally { await closeQueue(queue); await client.end(); }

});
