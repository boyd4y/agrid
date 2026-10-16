import assert from "node:assert/strict";
import { test } from "node:test";
import { assertTestRedisUrl } from "./fixtures.js";

test("worker fixture only accepts explicitly isolated local Redis endpoints without connecting", () => {
  for (const port of ["6381", "16381"]) {
    assert.doesNotThrow(() => assertTestRedisUrl(`redis://127.0.0.1:${port}`));
    assert.throws(() => assertTestRedisUrl(`redis://example.test:${port}`), /dedicated local test Redis/);
    assert.throws(() => assertTestRedisUrl(`redis://127.0.0.1@example.test:${port}`), /dedicated local test Redis/);
  }
  for (const endpoint of ["redis://127.0.0.1:6379", "redis://127.0.0.1", "redis://127.0.0.1:6380",
    "redis://192.168.1.2:16381", "http://127.0.0.1:16381"]) {
    assert.throws(() => assertTestRedisUrl(endpoint), /dedicated local test Redis/);
  }
});
