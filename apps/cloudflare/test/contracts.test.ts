import assert from "node:assert/strict";
import { test } from "node:test";
import { CoordinationError, parseCursor, parseExecutionReference } from "../src/contracts.js";

test("coordination references are immutable routing values; cursors reject lossy or malformed input", () => {
  const reference = parseExecutionReference({ executionId: "execution", runId: "run", threadId: "thread", principal: "ignored" });
  assert.deepEqual(reference, { executionId: "execution", runId: "run", threadId: "thread" });
  assert(Object.isFrozen(reference));
  for (const invalid of [undefined, null, {}, { ...reference, threadId: "" }, { ...reference, runId: "r".repeat(257) }]) {
    assert.throws(() => parseExecutionReference(invalid), CoordinationError);
  }
  assert.equal(parseCursor("15"), 15);
  assert.equal(parseCursor(0), 0);
  for (const invalid of ["", "-1", "1.5", "1e3", " 2 ", -1, Number.MAX_SAFE_INTEGER+1, NaN, null]) {
    assert.throws(() => parseCursor(invalid), CoordinationError);
  }
});

test("internal MAC binds body, method, route, audience and time; bounded verification never implies deduplication", async () => {
  const { signInternalRequest, verifyInternalRequest } = await import("../src/internal-auth.js");
  const config = { secret: "fixture-only-portable-control-secret-123456", audience: "runner", now: 1000000 };
  const request = await signInternalRequest(new Request("https://example.test/control?generation=1", { method: "POST", body: '{"executionId":"fixture"}' }), { ...config, requestId: "request-1" });
  const signedHeaders = Object.fromEntries(request.headers);
  const body = await request.text();
  const verify = (path: string, text: string, options = config, headers = signedHeaders, method = "POST") => verifyInternalRequest(new Request(`https://example.test${path}`, { method, headers, body: text }), options);
  const result = await verify("/control?generation=1", body);
  assert.deepEqual(result, { requestId: "request-1", issuedAt: 1000000, body });
  assert(Object.isFrozen(result));
  await assert.rejects(verify("/control?generation=2", body), /authentication failed/);
  await assert.rejects(verify("/control?generation=1", '{"executionId":"tampered"}'), /authentication failed/);
  await assert.rejects(verify("/control?generation=1", body, { ...config, audience: "other" }), /authentication failed/);
  await assert.rejects(verify("/control?generation=1", body, { ...config, now: 1100000 }), /authentication failed/);
  await assert.rejects(verify("/control?generation=1", body, config, {}, "POST"), /authentication failed/);
  await assert.rejects(verify("/control?generation=1", body, config, signedHeaders, "PUT"), /authentication failed/);
  await assert.rejects(verifyInternalRequest(new Request("https://example.test/control?generation=1", { method: "POST", headers: signedHeaders, body: "x".repeat(20000) }), config), /request rejected/);
});
