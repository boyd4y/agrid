import { acquireTaskLease } from "@tabdo/queue/lease";
import { randomUUID } from "node:crypto";
import { createRedisClient, type RedisClient } from "@tabdo/queue/redis";
import { leaseMs, positiveInt, prefix, redisOptions } from "./config.js";

export function createLeaseClient(): RedisClient {
  return createRedisClient(redisOptions(false), {
    name: `lease-${randomUUID()}`, onError: (e) => console.error("[lease]", e.message),
  });
}
/** Tabdo maps workspace/record identities onto generic resource/group keys. */
export function acquireRowLease(client: ReturnType<typeof createLeaseClient>, org: string, row: string) {
  return acquireTaskLease(client, {
    resourceKey: `${prefix}:row-lease:${org}:${row}`,
    groupKey: `${prefix}:tenant-leases:${org}`,
    token: randomUUID(), durationMs: leaseMs,
    concurrency: positiveInt("AUTOMATION_TENANT_CONCURRENCY", 4), now: Date.now,
  });
}
