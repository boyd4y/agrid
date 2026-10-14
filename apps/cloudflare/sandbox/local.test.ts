import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createTestHarness } from "wrangler";

test("real workerd DO container runs official Pi and restores a cold native question without tool replay", { timeout: 240000 }, async () => {
  const root = fileURLToPath(new URL("./fixture/", import.meta.url));
  const config = JSON.parse(await readFile(new URL("./fixture/wrangler.jsonc", import.meta.url), "utf8"));
  const harness = createTestHarness({ root, workers: [{ config }] });
  const sessionId = `native-container-${randomUUID()}`;
  let fixtureId = "";
  try {
    await harness.listen();
    fixtureId = (await (await harness.fetch(`/identity?sessionId=${sessionId}`)).json() as { id: string }).id;
    assert.match(fixtureId, /^[a-f0-9]{64}$/);
    const produced = await harness.fetch(`/produce?sessionId=${sessionId}`);
    assert.equal(produced.status, 200, await produced.clone().text());
    const first = await produced.json() as { checkpointSaved: boolean; actualContainerDestroyed: boolean; toolsExecuted: number; marker: string; providerCalls: number; boot: { node: string } };
    assert(first.checkpointSaved);assert(first.actualContainerDestroyed);assert.equal(first.toolsExecuted, 1);assert.equal(first.marker, "1");assert.equal(first.providerCalls, 2);assert.match(first.boot.node, /^v24\./);
    const consumed = await harness.fetch(`/consume?sessionId=${sessionId}`);
    assert.equal(consumed.status, 200, await consumed.clone().text());
    const second = await consumed.json() as { actualContainerDestroyed: boolean; toolsExecuted: number; marker: string; text: string; providerCalls: number };
    assert(second.actualContainerDestroyed);assert.equal(second.toolsExecuted, 0);assert.equal(second.marker, "1");assert.equal(second.providerCalls, 1);assert.equal(second.text, "Native answer B, no replay.");
  } finally {
    await harness.fetch(`/destroy?sessionId=${sessionId}`).catch(() => {});
    await harness.close();
    // Miniflare can leave its per-instance networking proxy after destruction.
    // Limit cleanup to this exact DO identity, never another local container.
    if (/^[a-f0-9]{64}$/.test(fixtureId)) {
      const owned = execFileSync("docker", ["ps", "-aq", "--filter", `name=workerd-tabdo-native-sandbox-fixture-NativeHarnessContainer-${fixtureId}`], { encoding: "utf8" }).trim().split(/\s+/).filter(id => /^[a-f0-9]{12,64}$/.test(id));
      if (owned.length) execFileSync("docker", ["rm", "-f", ...owned], { stdio: "ignore" });
    }
  }
});
