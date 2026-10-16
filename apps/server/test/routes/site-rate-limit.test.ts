import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createRedisClient, redisConnectionOptions, waitForRedisReady } from "@tabdo/queue/redis";
import { createSiteRateLimiter } from "../../src/site-api/rate-limit.js";

// Never use an application's Redis namespace for infrastructure tests.
test("site API limits are shared by replicas, separate reads/writes, and fail closed without Redis", { skip: !process.env.REDIS_URL }, async () => {
  const prefix = `agrid-queue-test-site-api-${randomUUID()}`;
  const url = process.env.REDIS_URL!;
  assert(new URL(url).hostname === "127.0.0.1" && ["6381", "16381"].includes(new URL(url).port), "Use dedicated local test Redis on port 6381 or 16381");
  const first = createSiteRateLimiter({ redisUrl: url, prefix, readLimit: 2, createLimit: 1 });
  const second = createSiteRateLimiter({ redisUrl: url, prefix, readLimit: 2, createLimit: 1 });
  const cleanup = createRedisClient(redisConnectionOptions(url, "producer"), { name: "site-limit-test-cleanup", onError: () => {} });
  const identity = { keyId: randomUUID(), ip: "127.0.0.1" };
  try {
    await first.check({ ...identity, kind: "read" }); await second.check({ ...identity, kind: "read" });
    await assert.rejects(first.check({ ...identity, kind: "read" }), (error: unknown) => (error as {status:number}).status === 429);
    await first.check({ ...identity, kind: "create" });
    await assert.rejects(second.check({ ...identity, kind: "create" }), (error: unknown) => (error as {status:number}).status === 429);
    await second.check({ ...identity, ip: "127.0.0.2", kind: "read" });
    await waitForRedisReady(cleanup);
    const keys = await cleanup.keys(`${prefix}:site-api:*`); assert.equal(keys.length, 3);
    assert((await cleanup.pttl(keys[0])) > 0);
    const unavailable = createSiteRateLimiter({ redisUrl: "", prefix });
    await assert.rejects(unavailable.check({ ...identity, kind: "create" }), (error: unknown) => (error as {status:number}).status === 503);
  } finally {
    await first.close(); await second.close();
    if (cleanup.status === "ready") { const keys = await cleanup.keys(`${prefix}:site-api:*`); if (keys.length) await cleanup.del(...keys); }
    cleanup.disconnect();
  }
});
