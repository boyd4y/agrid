import { sql } from "drizzle-orm";
import { getDatabase } from "../../resources/scope.js";
import { createAutomationQueue } from "./queues.js";

export async function automationQueueStatus() {
  const queue = createAutomationQueue();
  try {
    const outbox = await getDatabase().execute(sql`SELECT status, count(*)::int AS count,
      extract(epoch FROM now() - min(created_at))::int AS oldest_age_seconds
      FROM automation_outbox WHERE status <> 'done' GROUP BY status`);
    const state = await queue.status();
    return { outbox, queue: state.name, counts: state.counts, globalConcurrency: state.globalConcurrency };
  } finally { await queue.close(); }
}
