import assert from "node:assert/strict";
import { test } from "node:test";
import { parseQueueMessage } from "../src/index.js";

test("queue accepts unrelated payloads and leaves application validation to its caller", () => {
  const mail = { id: "mail-send-1", body: { recipient: "fixture@example.test", text: "hello" } };
  const cache = { id: "cache-refresh-1", body: { keys: ["home", "reports"] } };
  assert.deepEqual(parseQueueMessage(mail), mail);
  assert.deepEqual(parseQueueMessage(cache), cache);
  assert.deepEqual(parseQueueMessage({ id: "opaque-job", body: 42 }), { id: "opaque-job", body: 42 });
  for (const value of [null, {}, { id: "" }, { id: "job" }, { id: " ", body: {} }])
    assert.throws(() => parseQueueMessage(value), /Invalid queue message/);
});
