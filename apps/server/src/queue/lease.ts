import { acquireTaskLease } from "@tabdo/core/tasks/lease";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { leaseMs, positiveInt, prefix, redisOptions } from "./config.js";

export function createLeaseClient() {
  const client = new Redis({ ...redisOptions(false), connectionName: `lease-${randomUUID()}` });
  client.on("error", (e) => console.error("[lease]", e.message));
  return client;
}
/** Tabdo maps workspace/record identities onto generic resource/group keys. */
export function acquireRowLease(client: Redis, org: string, row: string) {
  return acquireTaskLease(client, {
    resourceKey: `${prefix}:row-lease:${org}:${row}`,
    groupKey: `${prefix}:tenant-leases:${org}`,
    token: randomUUID(), durationMs: leaseMs,
    concurrency: positiveInt("AUTOMATION_TENANT_CONCURRENCY", 4), now: Date.now,
  });
}
