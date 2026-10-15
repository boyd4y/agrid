import { LeaseOwnershipError, type LeaseProvider } from "./index.js";
import { createRedisClient, waitForRedisReady, type RedisOptions } from "./redis.js";

/** Minimal atomic store operations; no table IDs, actors or automation payloads. */
export type TaskLeaseStore = {
  eval(script: string, numberOfKeys: number, ...arguments_: (string | number)[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
};
export type TaskLeaseOptions = Readonly<{
  resourceKey: string;
  groupKey: string;
  token: string;
  durationMs: number;
  concurrency: number;
  now(): number;
}>;

/** Acquire an expiring resource lease with a bounded shared concurrency group. */
export async function acquireTaskLease(client: TaskLeaseStore, options: TaskLeaseOptions) {
  if (!options.resourceKey || !options.groupKey || options.resourceKey === options.groupKey || !options.token)
    throw new TypeError("Invalid task lease keys");
  for (const value of [options.durationMs, options.concurrency])
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Invalid task lease limits");
  const { resourceKey, groupKey } = options;
  const token = options.token, leaseMs = options.durationMs, now = options.now();
  const ok = await client.eval(`
    redis.call('zremrangebyscore', KEYS[2], '-inf', ARGV[2])
    if redis.call('exists',KEYS[1]) == 1 then return 0 end
    if redis.call('zcard',KEYS[2]) >= tonumber(ARGV[4]) then return 0 end
    redis.call('set',KEYS[1],ARGV[1],'PX',ARGV[3])
    redis.call('zadd',KEYS[2],tonumber(ARGV[2])+tonumber(ARGV[3]),ARGV[1])
    redis.call('pexpire',KEYS[2],tonumber(ARGV[3])*2)
    return 1`, 2, resourceKey, groupKey, token, now, leaseMs, options.concurrency);
  if (!ok) return null;
  let lost = false;
  let stopped = false;
  let renewal: Promise<unknown> | undefined;
  const timer = setInterval(() => {
    if (renewal || stopped) return;
    renewal = client.eval(`
      if redis.call('get',KEYS[1]) ~= ARGV[1] then return 0 end
      redis.call('pexpire',KEYS[1],ARGV[3])
      redis.call('zadd',KEYS[2],tonumber(ARGV[2])+tonumber(ARGV[3]),ARGV[1])
      redis.call('pexpire',KEYS[2],tonumber(ARGV[3])*2)
      return 1`, 2, resourceKey, groupKey, token, options.now(), leaseMs)
      .then((v) => { if (!v) lost = true; }).catch(() => { lost = true; }).finally(() => { renewal = undefined; });
  }, Math.max(50, Math.floor(leaseMs / 3)));
  timer.unref?.();
  return {
    async assertOwned() {
      if (lost || stopped || await client.get(resourceKey) !== token) throw new LeaseOwnershipError("Task lease ownership lost");
    },
    async release() {
      stopped = true; clearInterval(timer); await renewal;
      await client.eval(`
        if redis.call('get',KEYS[1]) == ARGV[1] then redis.call('del',KEYS[1]) end
        redis.call('zrem',KEYS[2],ARGV[1])
        return 1`, 2, resourceKey, groupKey, token).catch(() => {});
    },
  };
}

/** Driver resource only; worker owns when leases are acquired/released around task execution. */
export function createRedisLeaseProvider(options: {
  connection: RedisOptions; durationMs: number; concurrency: number;
  onError?: (error: Error) => void;
}): LeaseProvider {
  for (const value of [options.durationMs, options.concurrency])
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Invalid task lease limits");
  let client: ReturnType<typeof createRedisClient> | undefined;
  return {
    async acquire(keys) {
      const store = client ??= createRedisClient(options.connection, {
        name: `lease-${crypto.randomUUID()}`, onError: options.onError,
      });
      await waitForRedisReady(store);
      return acquireTaskLease(store, { ...keys, token: crypto.randomUUID(), durationMs: options.durationMs,
        concurrency: options.concurrency, now: Date.now });
    },
    async close() { client?.disconnect(); client = undefined; },
  };
}
