import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createHttpExecution } from "../src/adapters/http.js";
import { createNodeProcessExecution } from "../src/adapters/node-process.js";
import { createExecutionHttpHost, type ExecutionSnapshot } from "../src/transport/http-host.js";
import { InternalAuthenticationError, signInternalRequest, verifyInternalRequest } from "../src/internal-auth.js";
import type { ExecutionHandle } from "../src/index.js";

test("signed HTTP resource transport controls real child processes and refuses unauthenticated or altered work", { timeout: 10000 }, async () => {
  const authentication = { secret: "fixture-internal-secret-32bytes-minimum", audience: "compute-fixture" };
  let launches = 0, output = "";
  const processAdapter = createNodeProcessExecution({ executable: process.execPath, args: ["test/worker.mjs"], cwd: fileURLToPath(new URL("..", import.meta.url)), env: {}, onOutput: (_id, _channel, bytes) => { output += Buffer.from(bytes).toString(); } });
  // Durable application acceptance is tested in the PG runner suite. This transport
  // fixture only owns computing handles and explicitly rejects changed references.
  const handles = new Map<string, { handle: ExecutionHandle; input: string; exit?: { code: number | null; signal: string | null } }>();
  const snapshot = (id: string): ExecutionSnapshot | undefined => {
    const value = handles.get(id);return value ? { resource: value.handle.resource, state: value.exit ? "exited" : "running", ...(value.exit ? { exit: value.exit } : {}) } : undefined;
  };
  const host = createExecutionHttpHost({ authentication, services: {
    async accept(request) {
      const previous = handles.get(request.id);
      if (previous) {
        if (previous.input !== JSON.stringify(request.reference)) throw new Error("Accepted reference cannot change");
        return snapshot(request.id)!;
      }
      launches++;
      const handle = await processAdapter.start(request);
      const value = { handle, input: JSON.stringify(request.reference), exit: undefined as { code: number | null; signal: string | null } | undefined };
      handles.set(request.id, value);
      void handle.completion.then(exit => { value.exit = exit; });
      return snapshot(request.id)!;
    },
    async lookup(id) { return snapshot(id); },
    async terminate(id) { const value = handles.get(id);if (!value) return undefined;value.exit = await value.handle.terminate();return snapshot(id); },
  } });
  const server = createServer(async (incoming, outgoing) => {
    let body = "";for await (const bytes of incoming) body += bytes;
    const request = new Request(`http://127.0.0.1:${(server.address() as { port: number }).port}${incoming.url}`, { method: incoming.method, headers: incoming.headers as Record<string, string>, body });
    const response = await host(request);outgoing.writeHead(response.status, Object.fromEntries(response.headers));outgoing.end(await response.text());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();assert(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/executions`;
  const remote = createHttpExecution({ endpoint, authentication, pollIntervalMs: 10 });
  try {
    const unsigned = await fetch(`${endpoint}/start`, { method: "POST", body: JSON.stringify({ id: "unauthorized", reference: {} }) });assert.equal(unsigned.status, 401);assert.equal(launches, 0);
    const original = await signInternalRequest(new Request(`${endpoint}/start`, { method: "POST", body: JSON.stringify({ id: "changed", reference: {} }) }), { ...authentication, requestId: "altered-request" });
    const altered = await fetch(original.url, { method: "POST", headers: original.headers, body: JSON.stringify({ id: "changed", reference: { secret: "changed" } }) });assert.equal(altered.status, 401);assert.equal(launches, 0);
    const complete = await remote.start({ id: "http-report", reference: { message: "ready" } });
    assert.deepEqual(await complete.completion, { code: 0, signal: null });assert.equal(output, "ready");assert.equal(launches, 1);
    await remote.start({ id: "http-report", reference: { message: "ready" } });assert.equal(launches, 1);
    await assert.rejects(remote.start({ id: "http-report", reference: { message: "changed" } }), /503/);
    assert.equal(await remote.lookup("absent"), undefined);
    const waiting = await remote.start({ id: "http-wait", reference: { wait: true } });
    assert.deepEqual(await waiting.terminate(), { code: 0, signal: null });
    const stillRunning = await remote.start({ id: "http-observer", reference: { wait: true } });
    await remote.close();
    assert.equal(snapshot(stillRunning.resource.id)?.state, "running", "disconnecting HTTP observation never cancels computing");
  } finally {
    await remote.close();await processAdapter.close();server.closeAllConnections();await new Promise<void>(done => server.close(() => done()));
  }
});

test("WebCrypto signatures bind audience, method, path, timestamp and bounded body", async () => {
  const options = { secret: "fixture-auth-secret-at-least-32-bytes", audience: "runner", now: 1000, maxAgeMs: 100, maxBytes: 64 };
  const signed = await signInternalRequest(new Request("https://runner.invalid/executions/start", { method: "POST", body: "{}" }), { ...options, requestId: "fixture-signature" });
  assert.deepEqual(await verifyInternalRequest(signed.clone(), options), { requestId: "fixture-signature", issuedAt: 1000, body: "{}" });
  for (const invalid of [
    () => verifyInternalRequest(signed.clone(), { ...options, audience: "other" }),
    () => verifyInternalRequest(signed.clone(), { ...options, now: 1200 }),
    () => verifyInternalRequest(new Request("https://runner.invalid/executions/terminate", { method: "POST", headers: signed.headers, body: "{}" }), options),
    () => verifyInternalRequest(new Request(signed.url, { method: "PUT", headers: signed.headers, body: "{}" }), options),
  ]) await assert.rejects(invalid, error => error instanceof InternalAuthenticationError && error.status === 401);
  await assert.rejects(signInternalRequest(new Request(signed.url, { method: "POST", body: "x".repeat(65) }), { ...options, requestId: "too-big" }), error => error instanceof InternalAuthenticationError && error.status === 400);
});
