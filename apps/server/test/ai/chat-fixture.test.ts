import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bounded, withChatFixture, type ChatTestFixture } from "../helpers/chat-fixture.js";

const env = {
  PI_API_KEY: "fixture-key", AI_RUN_POLL_MS: "200", AI_CHAT_TOTAL_MS: "3000",
  AI_CHAT_FIRST_CHUNK_MS: "350", AI_CHAT_STEP_MS: undefined, AI_CHAT_CHUNK_MS: undefined,
};
const snapshot = () => Object.fromEntries([...Object.keys(env), "PI_BASE_URL"].map(key => [key, process.env[key]]));
const never = () => new Promise<void>(() => {});

for (const failure of ["no second request", "completion error", "test abort", "HTTP fixture exit", "handler error"] as const) {
  test(`chat fixture cleans up after ${failure} and restores the next case's environment`, { timeout: 5_000 }, async (t) => {
    const previous = snapshot();
    const abort = new AbortController();
    const original = new Error(failure);
    let stopped = 0, drained = 0, continued = false;
    let releaseStream = () => {};
    let provider: ChatTestFixture["provider"] | undefined;
    const operation = withChatFixture({ signal: abort.signal, after: t.after.bind(t), diagnostic: t.diagnostic.bind(t) }, {
      env,
      handler: (_request, response) => {
        if (failure === "handler error") throw original;
        response.end("original first-output timeout");
      },
      stop: async () => { releaseStream(); stopped++; assert.equal(process.env.AI_CHAT_FIRST_CHUNK_MS, "350"); },
      drained: async () => { drained++; assert.equal(provider?.listening, false); assert.equal(process.env.PI_API_KEY, "fixture-key"); },
    }, async (fixture) => {
      provider = fixture.provider;
      const response = await fixture.wait(fetch(process.env.PI_BASE_URL!));
      let completion = response.text();
      if (failure !== "no second request") {
        await completion;
        // Public web stream error, independent of the Harness implementation.
        completion = new Response(new ReadableStream({ start(controller) {
          if (failure === "completion error") controller.error(original);
          else releaseStream = () => controller.close();
        } })).text();
        if (failure === "test abort") { abort.abort(original); }
        if (failure === "HTTP fixture exit") fixture.provider.close();
      }
      await fixture.handshake(never(), completion, () => "modelRequests=1");
      continued = true;
    });
    await assert.rejects(bounded(operation, failure, 3_000), error => {
      if (["completion error", "test abort", "handler error"].includes(failure)) assert.equal(error, original);
      else if (failure === "no second request") assert.match(String(error), /modelRequests=1.*\noriginal first-output timeout/);
      else assert.match(String(error), /HTTP fixture closed/);
      return true;
    });
    assert.equal(continued, false, "assertions after a failed handshake never count as executed");
    assert.equal(stopped, 1); assert.equal(drained, 1);
    assert.deepEqual(snapshot(), previous);
    assert.equal(provider?.listening, false);
    // A succeeding case runs after each failure with the exact original globals.
    await withChatFixture(t, { env: { PI_API_KEY: "next-case" }, handler: (_request, response) => response.end("next case") }, async fixture => {
      assert.equal(process.env.AI_CHAT_FIRST_CHUNK_MS, previous.AI_CHAT_FIRST_CHUNK_MS);
      const response = await fixture.wait(fetch(process.env.PI_BASE_URL!));
      assert.equal(await fixture.wait(response.text()), "next case");
    });
    assert.deepEqual(snapshot(), previous);
  });
}

test("real Node test timeout runs cleanup before the next test and the process exits", { timeout: 10_000 }, async (t) => {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ["--import", "tsx", "--test", "--test-reporter=tap", fileURLToPath(new URL("../helpers/chat-timeout-fixture.ts", import.meta.url))], {
    env: childEnv, stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject); child.once("close", resolve);
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await bounded(exited, "timeout fixture subprocess cleanup");
    }
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const code = await bounded(exited, "timeout fixture subprocess", 7_000);
  assert.equal(code, 1, output);
  assert.match(output, /test timed out after 200ms/);
  assert.match(output, /NEXT_CASE_ENV_RESTORED/);
  assert.match(output, /# cancelled 1/);
  assert.match(output, /# pass 1/);
  assert(!output.includes("cleanup failed"), output);
});
