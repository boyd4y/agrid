import assert from "node:assert/strict";
import { test } from "node:test";
import { createCloudflareContainerExecution } from "../src/execution/container.js";
import type { ExecutionSnapshot } from "@tabdo/core/transport/execution-http-host";

test("Worker observer is lazy, validates physical identity and closing it never terminates compute", async () => {
  const resource = { id: "opaque-job", provider: "cloudflare-container", reference: "one-launch-token" };
  let lookups = 0, terminations = 0;
  const adapter = createCloudflareContainerExecution({ pollIntervalMs: 10, resolve: () => ({
    async startExecution() { return { resource,state: "running" }; },
    async lookupExecution() { lookups++;return { resource,state: "running" }; },
    async terminateExecution() { terminations++;return { resource,state: "exited",exit: { code: null,signal: null } }; },
  }) });
  const handle = await adapter.start({ id: resource.id,reference: { mailboxKey: "accepted" } });
  assert.equal(lookups,0,"start acknowledges resource boot without observing a whole execution");
  const completion = handle.completion;
  const closed = assert.rejects(completion,/observation closed/);
  await adapter.close();await closed;
  assert.equal(terminations,0,"request observer disposal never cancels durable work");
  await assert.rejects(adapter.lookup(resource.id),/closed/);

  const changed: ExecutionSnapshot = { resource: { ...resource,reference: "another-launch-token" },state: "exited",exit: { code: 0,signal: null } };
  const unsafe = createCloudflareContainerExecution({ pollIntervalMs: 10,resolve: () => ({
    async startExecution() { return { resource,state: "running" }; },
    async lookupExecution() { return changed; },
    async terminateExecution() { return changed; },
  }) });
  try {
    const original = await unsafe.start({ id: resource.id,reference: null });
    await assert.rejects(original.completion,/resource identity changed/);
    await assert.rejects(original.terminate(),/resource identity changed/);
  } finally { await unsafe.close(); }
});
