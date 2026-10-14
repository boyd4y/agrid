import "../load-env.js";
import type { RedisOptions } from "ioredis";

export function positiveInt(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
  return value;
}
export const prefix = process.env.QUEUE_PREFIX ?? "agrid";
export const redisUrl = process.env.REDIS_URL ?? (process.env.NODE_ENV === "production" ? "" : "redis://127.0.0.1:6380");
export const queueName = "automation";
export const attempts = positiveInt("AUTOMATION_ATTEMPTS", 5);
export const leaseMs = positiveInt("AUTOMATION_LEASE_MS", 30000);

export const reconcileStaleMs = positiveInt("AUTOMATION_RECONCILE_STALE_MS", 60000);
export const reconcileBatch = positiveInt("AUTOMATION_RECONCILE_BATCH", 25);

export function redisOptions(worker: boolean): RedisOptions {
  if (!redisUrl) throw new Error("REDIS_URL must be set for queue processes");
  const url = new URL(redisUrl);
  if (!["redis:", "rediss:"].includes(url.protocol)) throw new Error("REDIS_URL must use redis:// or rediss://");
  const redisDb = Number(url.pathname.slice(1) || 0);
  if (!Number.isSafeInteger(redisDb) || redisDb < 0) throw new Error("Invalid Redis database number");
  return {
    host: url.hostname, port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: redisDb,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: worker ? null : 1,
    enableOfflineQueue: worker,
    connectTimeout: 3000,
    ...(!worker ? { commandTimeout: 5000 } : {}),
    retryStrategy: (times) => Math.min(500 * times, 5000),
  };
}
