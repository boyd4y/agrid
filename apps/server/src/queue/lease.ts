import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { leaseMs, positiveInt, prefix, redisOptions } from "./config.js";

export function createLeaseClient() {
  const client = new Redis({ ...redisOptions(false), connectionName: `lease-${randomUUID()}` });
  client.on("error", (e) => console.error("[lease]", e.message));
  return client;
}
export async function acquireRowLease(client: Redis, org: string, row: string) {
  const token = randomUUID();
  const rowKey = `${prefix}:row-lease:${org}:${row}`;
  const tenantKey = `${prefix}:tenant-leases:${org}`;
  const now = Date.now();
  const ok = await client.eval(`
    redis.call('zremrangebyscore', KEYS[2], '-inf', ARGV[2])
    if redis.call('exists',KEYS[1]) == 1 then return 0 end
    if redis.call('zcard',KEYS[2]) >= tonumber(ARGV[4]) then return 0 end
    redis.call('set',KEYS[1],ARGV[1],'PX',ARGV[3])
    redis.call('zadd',KEYS[2],tonumber(ARGV[2])+tonumber(ARGV[3]),ARGV[1])
    redis.call('pexpire',KEYS[2],tonumber(ARGV[3])*2)
    return 1`, 2, rowKey, tenantKey, token, now, leaseMs, positiveInt("AUTOMATION_TENANT_CONCURRENCY", 4));
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
      return 1`, 2, rowKey, tenantKey, token, Date.now(), leaseMs)
      .then((v) => { if (!v) lost = true; }).catch(() => { lost = true; }).finally(() => { renewal = undefined; });
  }, Math.max(50, Math.floor(leaseMs / 3)));
  timer.unref();
  return {
    async assertOwned() {
      if (lost || stopped || await client.get(rowKey) !== token) throw new Error("Redis 行租约已失效");
    },
    async release() {
      stopped = true; clearInterval(timer); await renewal;
      await client.eval(`
        if redis.call('get',KEYS[1]) == ARGV[1] then redis.call('del',KEYS[1]) end
        redis.call('zrem',KEYS[2],ARGV[1])
        return 1`, 2, rowKey, tenantKey, token).catch(() => {});
    },
  };
}
