import assert from "node:assert/strict";
import { test } from "node:test";
import { redisConnectionOptions } from "../src/redis.js";

test("Redis policies preserve TLS, credentials and database while separating blocking workers from producers", () => {
  const producer = redisConnectionOptions("rediss://account:p%40ss@example.test:6381/2", "producer");
  assert.equal(producer.password, "p@ss");
  assert.equal(producer.username, "account");
  assert.equal(producer.db, 2);
  assert.deepEqual(producer.tls, {});
  assert.equal(producer.enableOfflineQueue, false);
  assert.equal(producer.maxRetriesPerRequest, 1);
  assert.equal(producer.commandTimeout, 5000);
  const worker = redisConnectionOptions("redis://localhost/0", "worker");
  assert.equal(worker.enableOfflineQueue, true);
  assert.equal(worker.maxRetriesPerRequest, null);
  assert.equal(worker.commandTimeout, undefined);
  for (const url of ["https://example.test", "redis://localhost/-1", "redis://localhost/1.5"])
    assert.throws(() => redisConnectionOptions(url, "producer"));
});
