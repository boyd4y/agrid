import { createDeliveryRecovery } from "@tabdo/worker/recovery";
import { createRecoveryStore } from "../../business/automation/delivery-recovery.js";
import { getDatabase } from "../../resources/scope.js";
import { reconcileStaleMs, reconcileBatch, queueName } from "./config.js";
import { rowLeaseKeys, createRowLeaseProvider } from "./lease.js";
import { createAutomationQueue, jobId } from "./queues.js";

export function createPublishedReconciler() {
  const store = createRecoveryStore({ database: getDatabase(), uuid: () => crypto.randomUUID(),
    staleMs: reconcileStaleMs, batchSize: reconcileBatch, queueName });
  return createDeliveryRecovery({
    queue: createAutomationQueue(), leases: createRowLeaseProvider(),
    claim: store.claim, recover: store.recover,
    messageId: (record) => jobId(record.event_id, record.generation),
    leaseKeys: (record) => rowLeaseKeys(record.organization_id, record.row_id ?? record.event_id),
  });
}
