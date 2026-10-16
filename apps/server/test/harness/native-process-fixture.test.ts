import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { bounded } from "../helpers/chat-fixture.js";
import { withNativeProcessFixture, type FixtureProcess } from "../helpers/native-process-fixture.js";

const never = () => new Promise<void>(() => {});

for (const failure of ["missing request", "missing phase", "early exit", "pending HTTP", "child deadline", "child error", "handler error", "spawn error"] as const) {
  test(`native fixture cleans up ${failure} without hiding the failure`, { timeout: 8_000 }, async t => {
    const abort = new AbortController(), original = new Error(failure);
    let owned: FixtureProcess | undefined, address: string | undefined;
    let fetchDone: Promise<unknown> | undefined;
    // A separate live child proves cleanup only targets this fixture's process group.
    const sentinel = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
    const sentinelClosed = once(sentinel, "close");
    t.after(async () => { sentinel.kill("SIGKILL"); await sentinelClosed; });
    const phases: string[] = [];
    await assert.rejects(withNativeProcessFixture({
      signal: abort.signal, after: () => {}, diagnostic: message => { phases.push(message); t.diagnostic(message); },
    }, async fixture => {
      address = await fixture.listen(async (_request, response) => {
        if (failure === "handler error") throw original;
        response.writeHead(200); response.flushHeaders();
        await fixture.delay(60_000);
      });
      if (failure === "spawn error") {
        owned = fixture.spawn("missing cwd", ["-e", ""], { cwd: `/tmp/tabdo-missing-${crypto.randomUUID()}` });
        await fixture.wait(owned.exited);
      } else if (failure === "early exit") {
        owned = fixture.spawn("early child", ["-e", ""], {});
        await fixture.until("model request 2", async () => false, owned);
      } else if (failure === "child error") {
        owned = fixture.spawn("failed child", ["-e", "console.error('fixture stderr evidence');process.exit(7)"], {});
        await fixture.wait(owned.exited);
      } else {
        owned = fixture.spawn("blocked child", ["-e", "process.on('SIGTERM',()=>{});process.send({fixturePhase:'ready'});setInterval(()=>{},1000)"], {}, failure === "child deadline" ? 500 : 30_000);
        await fixture.wait(once(owned.child, "message"));
        if (failure === "pending HTTP" || failure === "handler error") {
          const response = fetch(address);
          // Observe the body even if test cancellation wins the fixture wait.
          fetchDone = response.then(response => response.text());
          fetchDone.catch(() => {});
          if (failure === "pending HTTP") await fixture.wait(response);
        }
        if (failure === "missing request" || failure === "pending HTTP") abort.abort(original);
        if (failure === "missing phase") await fixture.until("model request 2", async () => false, owned, 50);
        await fixture.wait(never());
      }
    }), error => {
      if (failure === "spawn error") assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
      else if (failure === "early exit") assert.match(String(error), /Child exited before model request 2/);
      else if (failure === "missing phase") assert.match(String(error), /native lifecycle timed out waiting for model request 2 after 50ms/);
      else if (failure === "child error") assert.match(String(error), /code=7.*\nfixture stderr evidence/);
      else if (failure === "child deadline") assert.match(String(error), /child deadline after 500ms/);
      else assert.equal(error, original);
      return true;
    });
    assert(owned);
    assert(owned.child.exitCode !== null || owned.child.signalCode !== null);
    if (!["child error", "early exit", "spawn error", "child deadline"].includes(failure)) {
      assert.equal(owned.child.signalCode, "SIGKILL", "unresponsive child really needed escalation");
      assert(phases.some(phase => phase.includes("cleanup SIGKILL")));
    }
    if (fetchDone) await bounded(fetchDone.catch(() => {}), "closed HTTP body");
    await assert.rejects(fetch(address!));
    assert.equal(sentinel.exitCode, null); assert.equal(sentinel.signalCode, null);
  });
}

test("actual Node test cancellation closes native fixture resources before the next case", { timeout: 10_000 }, async t => {
  await assert.rejects(withNativeProcessFixture(t, async fixture => {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const child = fixture.spawn("Node timeout regression", ["--import", "tsx", "--test", "--test-reporter=tap", fileURLToPath(new URL("../helpers/native-timeout-fixture.ts", import.meta.url))], { env }, 7_000);
    await fixture.wait(child.exited);
  }), error => {
    assert.match(String(error), /code=1/);
    assert.match(String(error), /test timed out after 300ms/);
    assert.match(String(error), /NODE_TIMEOUT_NATIVE_RESOURCES_CLOSED/);
    assert.match(String(error), /# cancelled 1/);
    assert.match(String(error), /# pass 1/);
    return true;
  });
});
