import { inArray } from "drizzle-orm";
import type { ServerDatabase } from "../../src/business/db/factory.js";
import { automationEvents } from "../../src/business/db/schema.js";

/** Capture fixture ownership before deleting its organizations or rules. */
export async function deleteFixtureEvents(db: ServerDatabase, organizationIds: string[]) {
  if (!organizationIds.length) return;
  const events = await db.select({ id: automationEvents.id }).from(automationEvents)
    .where(inArray(automationEvents.organizationId, organizationIds));
  // The existing event FK deletes only these events' outbox records.
  if (events.length) await db.delete(automationEvents).where(inArray(automationEvents.id, events.map(event => event.id)));
}

/** Report every teardown failure while still closing the remaining resources. */
export async function cleanupFixture(steps: [string, () => Promise<unknown>][]) {
  const errors: Error[] = [];
  for (const [name, cleanup] of steps) {
    try { await cleanup(); }
    catch (cause) { errors.push(new Error(`Fixture cleanup failed: ${name}`, { cause })); }
  }
  if (errors.length) throw new AggregateError(errors, "Fixture cleanup failed");
}
