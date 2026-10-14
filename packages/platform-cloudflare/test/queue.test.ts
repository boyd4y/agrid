import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestHarness } from "wrangler";

test("generic mail and cache jobs execute through workerd Queues; failed acceptance retries", { timeout: 45000 }, async () => {
  const server = createTestHarness({ workers: [{ configPath: new URL("./fixture/queue/wrangler.jsonc", import.meta.url) }] });
  try {
    await server.listen();
    assert.equal((await server.fetch("/publish", { method: "POST", body: JSON.stringify({ id: "bad" }) })).status, 400);
    const env = await server.getWorker<QueueTestEnv>().getEnv();
    const jobs = [{ id: "mail-send-1", body: { recipient: "fixture@example.test", text: "hello" } },
      { id: "cache-refresh-1", body: { keys: ["home", "reports"] } }];
    await env.RECEIPTS.put(`fail-once/${jobs[0].id}`, "retry");
    for (const message of jobs) {
      assert.equal((await server.fetch("/publish", { method: "POST", body: JSON.stringify(message) })).status, 202);
      const deadline = Date.now() + 15000;
      let receipt: { message: typeof message; attempt: number } | undefined;
      while (Date.now() < deadline) {
        const response = await server.fetch(`/receipt?id=${message.id}`);
        if (response.ok) { receipt = await response.json() as typeof receipt; break; }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.deepEqual(receipt?.message, message);
      assert.equal(receipt?.attempt, message === jobs[0] ? 2 : 1);
    }
  } finally { await server.close(); }
});
