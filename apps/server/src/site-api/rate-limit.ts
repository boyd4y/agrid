import { createRedisClient, redisConnectionOptions, waitForRedisReady, type RedisClient } from "@tabdo/queue/redis";
import { sha256 } from "@tabdo/core/crypto";
import type { SiteRateLimit } from "../business/data-api/keys.js";
import { ServiceError } from "../business/errors.js";

/** Deployment composition only: replicas share the existing Redis, with no queue jobs. */
export function createSiteRateLimiter(options: { redisUrl: string; prefix: string; readLimit?: number; createLimit?: number }) {
  let client: RedisClient | undefined;
  const check: SiteRateLimit = async ({ keyId, ip, kind }) => {
    if (!options.redisUrl) throw new ServiceError(503, { message: "Site API rate limiting is unavailable" });
    try {
      client ??= createRedisClient(redisConnectionOptions(options.redisUrl, "producer"), { name: "tabdo-site-api", onError: () => {} });
      await waitForRedisReady(client);
      const identity = (await sha256(ip)).slice(0, 24);
      const limit = kind === "create" ? options.createLimit ?? 20 : options.readLimit ?? 120;
      const count = Number(await client.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],60000) end; return n", 1, `${options.prefix}:site-api:${keyId}:${identity}:${kind}`));
      if (count > limit) throw new ServiceError(429, { message: "Too many requests. Try again in a minute" });
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(503, { message: "Site API rate limiting is unavailable" });
    }
  };
  return { check, async close() { const closing = client; client = undefined; closing?.disconnect(); } };
}
const limiter = createSiteRateLimiter({ redisUrl: process.env.REDIS_URL ?? "", prefix: process.env.QUEUE_PREFIX ?? "tabdo" });
export const siteRateLimit = limiter.check;
export const closeSiteRateLimiter = limiter.close;
