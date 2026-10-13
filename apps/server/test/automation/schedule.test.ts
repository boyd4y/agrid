import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";

if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
const { db, client } = await import("../../src/db/index.js");
const { organization, user, member, automationRuns, automationEvents, automationOutbox, automationSchedules, automationOccurrences } = await import("../../src/db/schema.js");
const { createAutomation, updateAutomation } = await import("../../src/automation/crud.js");
const { createTable } = await import("../../src/commands/index.js");
const { schedulePreview, dispatchDueSchedules } = await import("../../src/automation/schedule.js");
const org = randomUUID(), owner = randomUUID(), scope = { organizationId: org, actorId: owner }, ruleIds: string[] = [];
before(async () => {
  await db.insert(user).values({ id: owner, name: "Schedule fixture", email: `${owner}@local.test` });
  await db.insert(organization).values({ id: org, name: "Schedule integration", slug: org });
  await db.insert(member).values({ id: randomUUID(), userId: owner, organizationId: org, role: "owner" });
});
after(async () => {
  if (ruleIds.length) await db.delete(automationRuns).where(inArray(automationRuns.automationId, ruleIds));
  await db.delete(automationEvents).where(eq(automationEvents.organizationId, org));
  await db.delete(organization).where(eq(organization.id, org));
  await db.delete(user).where(eq(user.id, owner));await client.end();
});
test("official cron previews use IANA time zones across missing and repeated DST hours", () => {
  assert.deepEqual(schedulePreview("30 2 * * *", "America/New_York", new Date("2026-03-07T08:00:00Z")), ["2026-03-08T07:30:00.000Z", "2026-03-09T06:30:00.000Z", "2026-03-10T06:30:00.000Z"]);
  assert.deepEqual(schedulePreview("30 1 * * *", "America/New_York", new Date("2026-11-01T00:00:00Z")), ["2026-11-01T05:30:00.000Z", "2026-11-02T06:30:00.000Z", "2026-11-03T06:30:00.000Z"]);
  assert.throws(() => schedulePreview("0 */5 * * * *", "UTC"));assert.throws(() => schedulePreview("H * * * *", "UTC"));assert.throws(() => schedulePreview("* * * * *", "Invalid/Zone"));
});
test("concurrent scoped dispatch commits one due occurrence, event and outbox; downtime is coalesced and rule versions resync", async () => {
  const table = await createTable({ ...scope, name: "Scheduled destination" });
  const rule = await createAutomation({ ...scope, source: { kind: "schedule", cron: "*/5 * * * *", timeZone: "Asia/Shanghai" }, name: "Due once", trigger: { type: "schedule_due" }, actions: [{ type: "command", command: "addRow", input: { tableId: table.id } }] });
  ruleIds.push(rule.id);
  const scheduledFor = new Date("2026-10-14T00:00:00Z"), now = new Date("2026-10-14T01:01:00Z");
  await db.update(automationSchedules).set({ nextRunAt: scheduledFor }).where(eq(automationSchedules.automationId, rule.id));
  assert.equal(await dispatchDueSchedules(now, 25, randomUUID()), 0, "other organizations cannot dispatch this fixture");
  const dispatched = await Promise.all([dispatchDueSchedules(now, 25, org), dispatchDueSchedules(now, 25, org)]);assert.equal(dispatched.reduce((sum, value) => sum + value, 0), 1);
  const occurrences = await db.select().from(automationOccurrences).where(eq(automationOccurrences.automationId, rule.id));assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].scheduledFor.toISOString(), scheduledFor.toISOString());assert.equal(occurrences[0].ruleVersion, rule.version);
  const [event] = await db.select().from(automationEvents).where(eq(automationEvents.id, occurrences[0].eventId));
  assert.equal(event.rowId, null);assert.equal(event.tableId, null);
  assert.deepEqual((event.snapshot.event as { data: unknown }).data, { scheduledFor: scheduledFor.toISOString(), dispatchedAt: now.toISOString(), timeZone: "Asia/Shanghai", delayed: true });
  assert.equal((await db.select().from(automationRuns).where(eq(automationRuns.eventId, event.id))).length, 1);
  assert.equal((await db.select().from(automationOutbox).where(eq(automationOutbox.eventId, event.id))).length, 1);
  assert.equal((await db.select().from(automationSchedules).where(eq(automationSchedules.automationId, rule.id)))[0].nextRunAt.toISOString(), "2026-10-14T01:05:00.000Z");
  assert.equal(await dispatchDueSchedules(now, 25, org), 0);
  // Force the old occurrence due again: the SQL unique constraint dedupes without creating another event.
  await db.update(automationSchedules).set({ nextRunAt: scheduledFor }).where(eq(automationSchedules.automationId, rule.id));
  assert.equal(await dispatchDueSchedules(now, 25, org), 0);
  assert.equal((await db.select().from(automationOccurrences).where(eq(automationOccurrences.automationId, rule.id))).length, 1);
  const updated = await updateAutomation({ ...scope, automationId: rule.id, name: "New version" });
  await db.update(automationSchedules).set({ ruleVersion: rule.version, nextRunAt: scheduledFor }).where(eq(automationSchedules.automationId, rule.id));
  assert.equal(await dispatchDueSchedules(now, 25, org), 0, "stale schedule versions are resynchronized, not dispatched");
  const [schedule] = await db.select().from(automationSchedules).where(eq(automationSchedules.automationId, rule.id));assert.equal(schedule.ruleVersion, updated.version);assert(schedule.nextRunAt > now);
  await updateAutomation({ ...scope, automationId: rule.id, enabled: false });
  assert.equal((await db.select().from(automationSchedules).where(and(eq(automationSchedules.automationId, rule.id)))).length, 0);
});
