import { Redis, type RedisOptions } from "ioredis";

export type { RedisOptions } from "ioredis";
export type RedisClient = Redis;

/** Connection policy is infrastructure; reading environment variables belongs to the caller. */
export function redisConnectionOptions(connectionString: string, role: "producer" | "worker"): RedisOptions {
  const url = new URL(connectionString);
  if (!["redis:", "rediss:"].includes(url.protocol)) throw new Error("Redis URL must use redis:// or rediss://");
  const db = Number(url.pathname.slice(1) || 0);
  if (!Number.isSafeInteger(db) || db < 0) throw new Error("Invalid Redis database number");
  const worker = role === "worker";
  return {
    host: url.hostname, port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db, ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: worker ? null : 1, enableOfflineQueue: worker,
    connectTimeout: 3000, ...(!worker ? { commandTimeout: 5000 } : {}),
    retryStrategy: (times) => Math.min(500 * times, 5000),
  };
}

export function createRedisClient(options: RedisOptions, config: {
  name: string;
  onError?: (error: Error) => void;
}): RedisClient {
  const client = new Redis({ ...options, connectionName: config.name });
  client.on("error", config.onError ?? ((error) => console.error("[redis]", error.message)));
  return client;
}
