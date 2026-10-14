import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import * as schema from "@tabdo/backend/schema";
import { createRelay, type OutboxRelayDependencies } from "@tabdo/backend/automation/outbox";
import type { AutomationDelivery } from "@tabdo/shared";
import { automationDeliveryId } from "@tabdo/shared";
import type { QueuePublisher } from "@tabdo/core/queue";

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_agent_test")) {
  throw new Error("Outbox fixtures require an isolated *_agent_test database");
}
// Real production columns/indexes in a fixture-only schema: global relay claims
// cannot consume another test's pending business event, even when tests overlap.
const namespace = `outbox_${randomUUID().replaceAll("-", "")}`;
const applicationName = `relay_${randomUUID()}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const primary = postgres(url, { max: 1, connection: { search_path: namespace, application_name: applicationName } });
const peer = postgres(url, { max: 1, connection: { search_path: namespace } });
const database = drizzle(primary, { schema }), peerDatabase = drizzle(peer, { schema });
before(async () => {
  await admin.unsafe(`CREATE SCHEMA "${namespace}"`);
  await admin.unsafe(`CREATE TABLE "${namespace}".automation_outbox (LIKE public.automation_outbox INCLUDING ALL)`);
  const [{ name }] = await primary<{ name: string }[]>`SELECT current_schema() AS name`;
  assert.equal(name, namespace);
});
beforeEach(async () => { await primary`TRUNCATE automation_outbox`; });
after(async () => {
  try { await Promise.all([primary.end(), peer.end()]); }
  finally { try { await admin.unsafe(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`); } finally { await admin.end(); } }
});
function relay(publisher: QueuePublisher<AutomationDelivery>, options: Partial<OutboxRelayDependencies> = {}) {
  return createRelay({ database, uuid: randomUUID, publisher, batchSize: 3, leaseMs: 30_000, concurrency: 2, ...options });
}
async function delivery() {
  const eventId = randomUUID();
  const [row] = await database.insert(schema.automationOutbox).values({
    eventId, queue: "fixture", payload: { protocol: 1, eventId, generation: 0 },
  }).returning();
  return row;
}
async function state(id: string) {
  return (await database.select().from(schema.automationOutbox).where(eq(schema.automationOutbox.id, id)))[0];
}
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

// These use native node:test and explicit DB dependencies, with no app/ALS/Auth scope.
test("concurrent relays claim different rows once and inject unique claim tokens", async () => {
  const records = await Promise.all(Array.from({ length: 6 }, delivery));
  const publisher = { async publish() {} };
  const first = relay(publisher), second = relay(publisher, { database: peerDatabase });
  const [a, b] = await Promise.all([first.claim(), second.claim()]);
  assert.equal(a.length, 3); assert.equal(b.length, 3);
  assert.equal(new Set([...a, ...b].map(row => row.id)).size, 6);
  assert.notEqual(a[0].claim_token, b[0].claim_token);
  assert.equal(new Set(a.map(row => row.claim_token)).size, 1);
  for (const record of records) {
    const row = await state(record.id);
    assert.equal(row.status, "publishing"); assert.equal(row.attempts, 1);
    assert(row.claimToken); assert(row.claimUntil);
  }
});

test("provider publication holds neither a transaction nor a row lock; success clears the lease", async () => {
  const row = await delivery(), entered = signal(), release = signal();
  let received: { id: string; body: AutomationDelivery } | undefined;
  const service = relay({ async publish(message) { received = message; entered.resolve(); await release.promise; } });
  const [claimed] = await service.claim(1);
  const pending = service.publish(claimed);
  try {
    await entered.promise;
    // Query the relay's one-connection pool while the provider is blocked. This
    // would hang if a transaction callback were still reserving that connection.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        database.execute(sql`SELECT 1`),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("provider held the database connection")), 1_000); }),
      ]);
    } finally { if (timeout) clearTimeout(timeout); }
    const [{ transaction }] = await peer<{ transaction: Date | null }[]>`
      SELECT xact_start AS transaction FROM pg_stat_activity WHERE application_name = ${applicationName}`;
    assert.equal(transaction, null);
    await peer.begin(async tx => {
      await tx`SET LOCAL statement_timeout = '500ms'`;
      await tx`UPDATE automation_outbox SET last_error = 'independent writer' WHERE id = ${row.id}`;
    });
  } finally { release.resolve(); }
  assert.equal(await pending, true);
  assert.deepEqual(received, { id: automationDeliveryId(row.payload), body: row.payload });
  const saved = await state(row.id);
  assert.equal(saved.status, "published"); assert(saved.publishedAt);
  assert.equal(saved.claimToken, null); assert.equal(saved.claimUntil, null); assert.equal(saved.lastError, null);
});

test("provider failures durably compensate with backoff and optional lifecycle cleanup", async () => {
  const row = await delivery();
  let closed = 0;
  const observations: string[] = [];
  const service = relay({ async publish() { throw new Error("provider refused"); }, async close() { closed++; throw new Error("cleanup refused"); } }, {
    logger: { error(event, id, message) { observations.push(`${event}:${id}:${message}`); } },
  });
  const [claimed] = await service.claim(1);
  const started = Date.now();
  assert.equal(await service.publish(claimed), false);
  const saved = await state(row.id);
  assert.equal(saved.status, "pending"); assert.equal(saved.attempts, 1);
  assert.equal(saved.lastError, "provider refused"); assert.equal(saved.publishedAt, null);
  assert.equal(saved.claimToken, null); assert.equal(saved.claimUntil, null);
  assert(saved.availableAt.getTime() >= started + 900);
  assert.equal(closed, 1); assert.equal(observations.length, 1);
  assert.equal((await service.claim(1)).length, 0, "backoff is authoritative in PG");
});

test("expired claims and superseded generations cannot publish or alter replacement ownership", async () => {
  const row = await delivery();
  let published = 0;
  const service = relay({ async publish() { published++; } });
  const [old] = await service.claim(1);
  await database.execute(sql`UPDATE automation_outbox SET claim_until = now() - interval '1 second' WHERE id = ${row.id}::uuid`);
  assert.equal(await service.publish(old), false);
  const [replacement] = await service.claim(1);
  assert.notEqual(replacement.claim_token, old.claim_token);
  const current = await state(row.id);
  assert.equal(await service.publish(old), false); assert.equal(published, 0);
  assert.deepEqual(await state(row.id), current);
  await database.execute(sql`UPDATE automation_outbox SET generation = generation + 1 WHERE id = ${row.id}::uuid`);
  const newer = await state(row.id);
  assert.equal(await service.publish(replacement), false); assert.equal(published, 0);
  assert.deepEqual(await state(row.id), newer);
});

for (const fail of [false, true]) {
  test(`late provider ${fail ? "failure" : "success"} cannot overwrite a reclaimed lease`, async () => {
    const row = await delivery(), entered = signal(), release = signal();
    const service = relay({ async publish() { entered.resolve(); await release.promise; if (fail) throw new Error("late failure"); } });
    const [old] = await service.claim(1);
    const pending = service.publish(old);
    let current;
    try {
      await entered.promise;
      await peer`UPDATE automation_outbox SET claim_until = now() - interval '1 second' WHERE id = ${row.id}`;
      const replacement = relay({ async publish() {} }, { database: peerDatabase });
      const [claimed] = await replacement.claim(1);
      assert.notEqual(claimed.claim_token, old.claim_token);
      current = await state(row.id);
    } finally { release.resolve(); }
    assert.equal(await pending, !fail, "return value preserves the existing provider acceptance contract");
    assert.deepEqual(await state(row.id), current, "both success ACK and failure compensation are fenced by token/generation");
  });
}

test("tick respects configured concurrency while publishing each claimed delivery once", async () => {
  await Promise.all(Array.from({ length: 6 }, delivery));
  let active = 0, peak = 0;
  const ids = new Set<string>();
  const service = relay({ async publish(message) {
    assert(!ids.has(message.id)); ids.add(message.id); active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
  } }, { batchSize: 6, concurrency: 2 });
  assert.equal(await service.tick(), 6); assert.equal(ids.size, 6); assert.equal(peak, 2);
  assert.equal((await database.select().from(schema.automationOutbox)).filter(row => row.status === "published").length, 6);
});
