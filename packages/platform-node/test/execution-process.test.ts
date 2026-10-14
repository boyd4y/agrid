import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createNodeProcessExecution } from "../src/execution/node-process.js";
import { parseExecutionRequest } from "@tabdo/core/execution";
const cwd = fileURLToPath(new URL("..", import.meta.url));
test("generic process executes references, owns handles and terminates explicitly", async () => {
  let output = "";
  const adapter = createNodeProcessExecution({ executable: process.execPath, args: ["test/worker.mjs"], cwd, env: {}, onOutput: (_id, _channel, bytes) => { output += Buffer.from(bytes).toString(); } });
  try {
    const first = await adapter.start({ id: "report-example", reference: { message: "done" } });
    assert.equal(first.resource.provider, "node-process");
    assert.deepEqual(await first.completion, { code: 0, signal: null });
    assert.equal(output, "done");
    assert.equal(await adapter.lookup(first.resource.id), undefined);
    const waiting = await adapter.start({ id: "waiting-example", reference: { wait: true } });
    assert.equal(await adapter.lookup(waiting.resource.id), waiting);
    assert.equal(await adapter.start({ id: "waiting-example", reference: { wait: true } }), waiting);
    await assert.rejects(adapter.start({ id: "waiting-example", reference: { wait: false } }), /cannot change/);
    assert.deepEqual(await waiting.terminate(), { code: 0, signal: null });
  } finally { await adapter.close(); }
  await assert.rejects(adapter.start({ id: "closed", reference: {} }), /closed/);
});
test("early process exits and nonportable references fail without certifying nonexecution", async () => {
  const adapter = createNodeProcessExecution({ executable: process.execPath, args: ["-e", "process.exit(2)"], cwd, env: {} });
  try { await assert.rejects(adapter.start({ id: "unknown", reference: {} }), /before resource startup/); }
  finally { await adapter.close(); }
  assert.throws(() => parseExecutionRequest({ id: "work", reference: { callback() {} } }), /reference/);
  assert.throws(() => parseExecutionRequest({ id: "work", reference: Infinity }), /reference/);
});
