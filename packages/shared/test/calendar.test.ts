import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { CALENDAR_SCHEMAS, CALENDAR_COMMANDS, CALENDAR_TOOLS, COMMANDS, PLATFORM_TOOL_IDS, calendarPermissionSchema } from "../src/index.js";
const calendarId = randomUUID(), personId = randomUUID();
test("calendar contracts reject forged scope, naive dates, invalid days and incomplete writes", () => {
  assert(!CALENDAR_SCHEMAS.createBooking.safeParse({ calendarId, personId, title: "Visit", time: { start: "2030-01-07T09:00:00", end: "2030-01-07T09:30:00", timeZone: "UTC" }, idempotencyKey: "1" }).success);
  assert(!CALENDAR_SCHEMAS.setAvailabilityException.safeParse({ calendarId, personId, date: "not-a-date", intervals: [{ start: "00:00", end: "24:00" }], idempotencyKey: "1" }).success);
  assert(!CALENDAR_SCHEMAS.setAvailabilityException.safeParse({ calendarId, personId, date: "2030-02-30", intervals: [{ start: "00:00", end: "24:00" }], idempotencyKey: "1" }).success);
  assert(!CALENDAR_SCHEMAS.getCalendar.safeParse({ calendarId, organizationId: "forged" }).success);
  assert(!CALENDAR_SCHEMAS.cancelBooking.safeParse({ calendarId, bookingId: randomUUID(), idempotencyKey: "1" }).success);
  assert(!CALENDAR_SCHEMAS.batchBookings.safeParse({ calendarId, operations: [], idempotencyKey: "1" }).success);
  assert(!CALENDAR_SCHEMAS.batchBookings.safeParse({ calendarId, operations: Array.from({ length: 101 }, () => ({ kind: "cancel", bookingId: randomUUID(), expectedVersion: 1 })), idempotencyKey: "1" }).success);
  assert(!calendarPermissionSchema.safeParse({ calendarId, canRead: false, canReadAvailability: false, canCreate: false, canUpdate: false, canCancel: false, canManage: false }).success);
});
test("weekly hours are finite nonoverlapping wall-clock windows, not booking recurrence", () => {
  const common = { calendarId, personId, expectedVersion: 1, idempotencyKey: "hours" };
  assert(CALENDAR_SCHEMAS.setWorkingHours.safeParse({ ...common, windows: [{ day: 1, start: "00:00", end: "24:00" }] }).success);
  assert(!CALENDAR_SCHEMAS.setWorkingHours.safeParse({ ...common, windows: [{ day: 1, start: "09:00", end: "10:00" }, { day: 1, start: "09:30", end: "10:30" }] }).success);
  assert(CALENDAR_SCHEMAS.setWorkingHours.safeParse({ ...common, windows: [{ day: 1, start: "09:00", end: "10:00" }, { day: 1, start: "10:00", end: "11:00" }] }).success);
});
test("every promised calendar operation has a named public command and configurable native/MCP ID", () => {
  assert.equal(CALENDAR_COMMANDS.length, 26);
  assert.deepEqual(new Set(Object.values(CALENDAR_TOOLS).map(item => item.command)), new Set(CALENDAR_COMMANDS));
  for (const command of CALENDAR_COMMANDS) assert(COMMANDS.includes(command));
  for (const name of Object.keys(CALENDAR_TOOLS)) assert((PLATFORM_TOOL_IDS as readonly string[]).includes(name));
});

test("reminder offsets, deadlines and schedule projections reject ambiguous or unbounded input", () => {
  const common = { calendarId, bookingId: randomUUID(), expectedVersion: 1, idempotencyKey: "reminders" };
  const reminder = { kind: "before_start", offsetMinutes: 30, agentUserId: "agent", prompt: "Prepare" };
  assert(CALENDAR_SCHEMAS.setBookingReminders.safeParse({ ...common, reminders: [reminder] }).success);
  for (const change of [{ offsetMinutes: 0 }, { kind: "at_end" }, { maxLatenessMinutes: 0 }, { provider: "forged" }, { workspaceId: randomUUID() }])
    assert(!CALENDAR_SCHEMAS.setBookingReminders.safeParse({ ...common, reminders: [{ ...reminder, ...change }] }).success);
  assert(!CALENDAR_SCHEMAS.setBookingReminders.safeParse({ ...common, reminders: [reminder, reminder] }).success);
  assert(CALENDAR_SCHEMAS.setBookingReminders.safeParse({ ...common, reminders: [] }).success);
  assert(!CALENDAR_SCHEMAS.queryScheduledOccurrences.safeParse({ rangeStart: "2030-01-01T00:00:00Z", rangeEnd: "2031-01-01T00:00:00Z" }).success);
});
