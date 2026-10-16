import assert from "node:assert/strict";
import { test } from "node:test";
import { withNativeProcessFixture, type FixtureProcess } from "./native-process-fixture.js";

let child: FixtureProcess | undefined;
let baseUrl: string | undefined;
test("native fixture observes the actual Node test deadline", { timeout: 300 }, async t => {
  await withNativeProcessFixture(t, async fixture => {
    baseUrl = await fixture.listen((_request, response) => { response.flushHeaders(); });
    child = fixture.spawn("pending child", ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { env: { PATH: process.env.PATH } });
    await fixture.wait(new Promise<void>(() => {}));
    assert.fail("cancelled wait must not pass");
  });
});
test("the next test sees closed child and HTTP resources", async () => {
  assert(child);
  assert(child.child.exitCode !== null || child.child.signalCode !== null);
  await assert.rejects(fetch(baseUrl!));
  console.log("NODE_TIMEOUT_NATIVE_RESOURCES_CLOSED");
});
