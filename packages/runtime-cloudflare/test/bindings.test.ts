import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestHarness } from "wrangler";

test("adapters execute in workerd with real local R2 and Queue bindings", { timeout: 45000 }, async () => {
  const server = createTestHarness({ workers: [{ configPath: new URL("./fixture/wrangler.jsonc", import.meta.url) }] });
  try {
    await server.listen();
    const eventId = "e39e1b5e-ae42-4c50-9179-3597fe83fef1";
    const objectPath = `/${encodeURIComponent(`e3/${eventId}`)}`;
    const bytes = new Uint8Array([0, 255, 3, 128, 10]);
    assert.equal((await server.fetch(objectPath, { method: "PUT", body: bytes, headers: { "content-type": "application/octet-stream" } })).status, 201);
    assert.deepEqual(new Uint8Array(await (await server.fetch(objectPath)).arrayBuffer()), bytes);
    assert.equal((await server.fetch(`/${encodeURIComponent("../secret")}`)).status, 400);
    assert.equal((await server.fetch(objectPath, { method: "DELETE" })).status, 204);
    assert.equal((await server.fetch(objectPath)).status, 404);

    assert.equal((await server.fetch("/deliver", { method: "POST", body: JSON.stringify({ protocol: 2 }) })).status, 400);
    const delivery = { protocol: 1, eventId, generation: 3 };
    const env = await server.getWorker<Env>().getEnv();
    await env.OBJECTS.put(`fail-once/${eventId}`, "retry");
    assert.equal((await server.fetch("/deliver", { method: "POST", body: JSON.stringify(delivery) })).status, 202);
    const deadline = Date.now() + 15000;
    let receipt: { delivery: typeof delivery; attempt: number } | undefined;
    while (Date.now() < deadline) {
      const response = await server.fetch(objectPath);
      if (response.ok) { receipt = await response.json() as typeof receipt; break; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.deepEqual(receipt?.delivery, delivery);
    assert.equal(receipt?.attempt, 2, "first failed acceptance retried instead of being acknowledged");
  } finally { await server.close(); }
});
