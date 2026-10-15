import { createRedisLeaseProvider } from "@tabdo/queue/lease";
import { leaseMs, positiveInt, prefix, redisOptions } from "./config.js";

export const rowLeaseKeys = (org: string, row: string) => ({
  resourceKey: `${prefix}:row-lease:${org}:${row}`,
  groupKey: `${prefix}:tenant-leases:${org}`,
});
export function createRowLeaseProvider() {
  return createRedisLeaseProvider({
    connection: redisOptions(false), durationMs: leaseMs,
    concurrency: positiveInt("AUTOMATION_TENANT_CONCURRENCY", 4),
    onError: (error) => console.error("[lease]", error.message),
  });
}
