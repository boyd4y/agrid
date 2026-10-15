import "../../load-env.js";
import { redisConnectionOptions } from "@tabdo/queue/redis";

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

export function redisOptions(worker: boolean) {
  if (!redisUrl) throw new Error("REDIS_URL must be set for queue processes");
  return redisConnectionOptions(redisUrl, worker ? "worker" : "producer");
}
