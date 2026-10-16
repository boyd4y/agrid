import assert from "node:assert/strict";
import { test } from "node:test";
import { withChatFixture } from "./chat-fixture.js";

const keys = ["PI_API_KEY", "PI_BASE_URL", "AI_RUN_POLL_MS", "AI_CHAT_TOTAL_MS", "AI_CHAT_FIRST_CHUNK_MS", "AI_CHAT_STEP_MS", "AI_CHAT_CHUNK_MS"];
// Cover absent, empty, and populated globals with the actual Node timeout signal.
delete process.env.AI_CHAT_FIRST_CHUNK_MS;
process.env.AI_CHAT_STEP_MS = "";
process.env.AI_CHAT_CHUNK_MS = "original-chunk-limit";
const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
let closed = false;

test("owned handshake is cancelled by the Node test deadline", { timeout: 200 }, async (t) => {
  await withChatFixture(t, {
    env: { PI_API_KEY: "timeout-fixture", AI_RUN_POLL_MS: "200", AI_CHAT_TOTAL_MS: "3000", AI_CHAT_FIRST_CHUNK_MS: "350", AI_CHAT_STEP_MS: undefined, AI_CHAT_CHUNK_MS: undefined },
    handler: (_request, response) => { response.writeHead(200); response.flushHeaders(); },
    drained: async () => { assert.equal(process.env.PI_API_KEY, "timeout-fixture"); closed = true; },
  }, async fixture => {
    const response = await fixture.wait(fetch(process.env.PI_BASE_URL!));
    await fixture.handshake(new Promise<void>(() => {}), response.text(), () => "modelRequests=1");
    assert.fail("unreached handshake must never pass");
  });
});

test("the following case sees no leaked timeout settings or open HTTP fixture", () => {
  assert.equal(closed, true);
  assert.deepEqual(Object.fromEntries(keys.map(key => [key, process.env[key]])), before);
  console.log("NEXT_CASE_ENV_RESTORED");
});
