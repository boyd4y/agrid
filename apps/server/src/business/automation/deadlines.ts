import { sql } from "drizzle-orm";
import type { CommandDependencies } from "../dependencies.js";

/** Read deadlines only after work or a configuration change, never on an idle timer. */
export async function nextScheduleDeadline(deps: CommandDependencies): Promise<Date | null> {
  const [row] = await deps.database.execute(sql`
    SELECT min(s.next_run_at) AS at FROM automation_schedules s
    JOIN automations a ON a.id = s.automation_id
    WHERE a.enabled = true AND a.deleted_at IS NULL
  `);
  return row?.at ? new Date(row.at as string | Date) : null;
}
export async function nextOutboxDeadline(deps: CommandDependencies): Promise<Date | null> {
  const [row] = await deps.database.execute(sql`
    SELECT min(CASE WHEN status = 'pending' THEN available_at ELSE claim_until END) AS at
    FROM automation_outbox WHERE queue = ${deps.automationQueueName}
      AND status IN ('pending', 'publishing')
  `);
  return row?.at ? new Date(row.at as string | Date) : null;
}
