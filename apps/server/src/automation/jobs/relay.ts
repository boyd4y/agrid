import { createRelay as createBusinessRelay } from "../../business/automation/outbox.js";
import type { QueuePublisher } from "@tabdo/queue";
import type { AutomationDelivery } from "@tabdo/shared";
import { getDatabase } from "../../resources/scope.js";
import { positiveInt } from "./config.js";

/** Node composition only. Each invocation captures its caller's explicit resource scope. */
export function createRelay(publisher: QueuePublisher<AutomationDelivery>) {
  return createBusinessRelay({
    database: getDatabase(), uuid: () => crypto.randomUUID(), publisher,
    batchSize: positiveInt("AUTOMATION_RELAY_BATCH", 25),
    leaseMs: positiveInt("AUTOMATION_RELAY_LEASE_MS", 30000), concurrency: 8,
    logger: { error: (event, id, error) => console.error(`[${event}]`, id, error) },
  });
}
