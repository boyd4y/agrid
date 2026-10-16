import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "../../src/business/db/factory.js";
import { organization, automationEvents, automationOutbox } from "../../src/business/db/schema.js";
import { cleanupFixture, deleteFixtureEvents } from "../helpers/fixture-cleanup.js";

test("fixture event cleanup uses owned IDs and the outbox FK while preserving a peer event", async () => {
  const connectionString = process.env.DATABASE_URL ?? "";
  assert(new URL(connectionString).pathname.endsWith("_agent_test"));
  const resource = createDatabase({ connectionString, poolMax: 2 });
  const org = randomUUID(), peer = randomUUID(), owned = [randomUUID(), randomUUID()], sentinel = randomUUID();
  try {
    await resource.db.insert(organization).values([
      { id: org, name: "Event cleanup", slug: org }, { id: peer, name: "Event cleanup peer", slug: peer },
    ]);
    await resource.db.insert(automationEvents).values([...owned, sentinel].map(id => ({
      id, organizationId: id === sentinel ? peer : org, snapshot: { name: "Same event name" },
    })));
    await resource.db.insert(automationOutbox).values([...owned, sentinel].map(eventId => ({
      eventId, queue: "fixture-cleanup", payload: { protocol: 1 as const, eventId, generation: 0 },
    })));
    const [peerEvent] = await resource.db.select().from(automationEvents).where(eq(automationEvents.id, sentinel));
    const [peerOutbox] = await resource.db.select().from(automationOutbox).where(eq(automationOutbox.eventId, sentinel));
    await deleteFixtureEvents(resource.db, []);
    assert.equal((await resource.db.select().from(automationEvents).where(inArray(automationEvents.id, owned))).length, 2);
    await deleteFixtureEvents(resource.db, [org]);
    assert.equal((await resource.db.select().from(automationEvents).where(inArray(automationEvents.id, owned))).length, 0);
    assert.equal((await resource.db.select().from(automationOutbox).where(inArray(automationOutbox.eventId, owned))).length, 0);
    assert.deepEqual(await resource.db.select().from(automationEvents).where(eq(automationEvents.id, sentinel)), [peerEvent]);
    assert.deepEqual(await resource.db.select().from(automationOutbox).where(eq(automationOutbox.eventId, sentinel)), [peerOutbox]);
  } finally {
    await cleanupFixture([
      ["owned events and peer sentinel", () => deleteFixtureEvents(resource.db, [org, peer])],
      ["organization", () => resource.db.delete(organization).where(eq(organization.id, org))],
      ["peer organization", () => resource.db.delete(organization).where(eq(organization.id, peer))],
      ["database", () => resource.close()],
    ]);
  }
});

test("fixture cleanup reports failures and still closes every remaining resource", async () => {
  const failure = new Error("event delete failed"), closeFailure = new Error("first pool close failed");
  const completed: string[] = [];
  await assert.rejects(cleanupFixture([
    ["owned events/outbox", async () => { throw failure; }],
    ["organization", async () => { completed.push("organization"); }],
    ["database A", async () => { throw closeFailure; }],
    ["database B", async () => { completed.push("database B"); }],
  ]), (error: unknown) => {
    assert(error instanceof AggregateError);
    assert.deepEqual(error.errors.map(value => value.cause), [failure, closeFailure]);
    assert.deepEqual(error.errors.map(value => value.message), [
      "Fixture cleanup failed: owned events/outbox", "Fixture cleanup failed: database A",
    ]);
    return true;
  });
  assert.deepEqual(completed, ["organization", "database B"]);
});
