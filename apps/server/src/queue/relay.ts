import { createRelay as createBackendRelay } from "@tabdo/backend/automation/outbox";
import type { OutboxDelivery } from "@tabdo/backend/automation/outbox";
import type { QueuePublisher } from "@tabdo/core/queue";
import type { AutomationDelivery } from "@tabdo/shared";
import { getDatabase } from "../resources/scope.js";
import { positiveInt } from "./config.js";

/** Node composition only. Each invocation captures its caller's explicit resource scope. */
export function createRelay(publisher: QueuePublisher<AutomationDelivery>) {
  const service = () => createBackendRelay({
    database: getDatabase(), uuid: () => crypto.randomUUID(), publisher,
    batchSize: positiveInt("AUTOMATION_RELAY_BATCH", 25),
    leaseMs: positiveInt("AUTOMATION_RELAY_LEASE_MS", 30000), concurrency: 8,
    logger: { error: (event, id, error) => console.error(`[${event}]`, id, error) },
  });
  return {
    claim: (limit?: number) => service().claim(limit),
    publish: (record: OutboxDelivery) => service().publish(record),
    tick: () => service().tick(),
    close: () => publisher.close?.() ?? Promise.resolve(),
  };
}
