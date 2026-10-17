import { and, asc, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import type { BookingReminder, AutomationRule, BookingReminderIntent } from "@tabdo/shared";
import type { CommandDependencies, RuntimeDependencies } from "../dependencies.js";
import type { Transaction } from "../db/types.js";
import { bookings, bookingReminders, bookingReminderIntents, calendars, calendarPeople, automations,
  automationEvents, automationRuns, automationAgentActions, chatThreads, member, agentProfile, userApiKeys, apiKeyCalendars } from "../db/schema.js";
import { appendExternalAutomationEvent } from "../automation/events.js";
import { CalendarError } from "./errors.js";

type StoredBooking = typeof bookings.$inferSelect;
/** Caller already owns calendar -> person -> booking locks, including batch writes. */
export async function syncBookingReminders(deps: CommandDependencies, tx: Transaction, booking: StoredBooking) {
  await tx.update(bookingReminderIntents).set({ status: "superseded", reason: "booking_revision_changed" }).where(and(
    eq(bookingReminderIntents.bookingId, booking.id), inArray(bookingReminderIntents.status, ["pending", "queued"])));
  if (booking.status !== "confirmed") return;
  const configurations = await tx.select().from(bookingReminders).where(and(eq(bookingReminders.bookingId, booking.id), eq(bookingReminders.enabled, true)));
  for (const reminder of configurations) {
    const config = reminder.configuration;
    const scheduledFor = new Date(config.kind === "before_start" ? +booking.start - config.offsetMinutes * 60000 : +booking.end);
    await tx.insert(bookingReminderIntents).values({ workspaceId: booking.workspaceId, bookingId: booking.id, reminderId: reminder.id,
      revision: booking.revision, kind: config.kind, offsetMinutes: config.offsetMinutes, scheduledFor }).onConflictDoNothing();
  }
  deps.wakeAfterCommit?.(tx, { kind: "schedules" });
}

export async function replaceBookingReminders(deps: CommandDependencies, tx: Transaction, booking: StoredBooking,
  configurations: BookingReminder[], actorId: string, keyId: string | null) {
  if (booking.status !== "confirmed") throw new CalendarError(409, "INVALID_STATE", "Only confirmed bookings can have reminders");
  const [owner] = await tx.select().from(member).where(and(eq(member.userId, actorId), eq(member.organizationId, (await tx.select().from(calendars).where(eq(calendars.id, booking.calendarId)))[0].organizationId))).for("share");
  if (!owner) throw new CalendarError(403, "FORBIDDEN", "Reminder creator must remain a member");
  // Immutable rules retain the accepted run's identity when settings are replaced.
  // They can only be managed through booking commands, never generic automation edits.
  await tx.update(bookingReminders).set({ enabled: false }).where(eq(bookingReminders.bookingId, booking.id));
  for (const configuration of configurations) {
    const [agent] = await tx.select({ id: agentProfile.id }).from(agentProfile).innerJoin(member, eq(member.id, agentProfile.memberId))
      .where(and(eq(agentProfile.userId, configuration.agentUserId), eq(member.organizationId, owner.organizationId))).for("share", { of: member });
    if (!agent) throw new CalendarError(400, "BAD_INPUT", "Choose an active agent in the current enterprise");
    const id = deps.uuid();
    const [rule] = await tx.insert(automations).values({ organizationId: owner.organizationId, workspaceId: booking.workspaceId,
      createdByUserId: actorId, tableId: null, name: booking.title, source: { kind: "calendar", calendarId: booking.calendarId, bookingId: booking.id, reminderId: id },
      trigger: { type: configuration.kind === "before_start" ? "booking_reminder_due" : "booking_due" },
      actions: [{ type: "run_agent", agentUserId: configuration.agentUserId, prompt: configuration.prompt }], conditions: [], eventConditions: [] }).returning();
    await tx.insert(bookingReminders).values({ id, workspaceId: booking.workspaceId, bookingId: booking.id, createdByUserId: actorId, keyId,
      configuration, automationId: rule.id });
  }
  const updated = { ...booking, version: booking.version + 1, revision: booking.revision + 1 };
  await tx.update(bookings).set({ version: updated.version, revision: updated.revision }).where(eq(bookings.id, booking.id));
  await syncBookingReminders(deps, tx, updated);
  return { id: updated.id, version: updated.version, revision: updated.revision, status: updated.status };
}

export async function readBookingReminders(tx: Transaction, booking: StoredBooking, viewerId?: string) {
  const reminders = await tx.select().from(bookingReminders).where(and(eq(bookingReminders.bookingId, booking.id), eq(bookingReminders.enabled, true)));
  const history = await tx.select({ intent: bookingReminderIntents, run: automationRuns, mapping: automationAgentActions, thread: chatThreads })
    .from(bookingReminderIntents).leftJoin(automationRuns, eq(automationRuns.eventId, bookingReminderIntents.eventId))
    .leftJoin(automationAgentActions, and(eq(automationAgentActions.runId, automationRuns.id), eq(automationAgentActions.step, 0)))
    .leftJoin(chatThreads, eq(chatThreads.id, automationAgentActions.threadId))
    .where(eq(bookingReminderIntents.bookingId, booking.id)).orderBy(desc(bookingReminderIntents.revision), desc(bookingReminderIntents.scheduledFor)).limit(501);
  if (history.length > 500) throw new CalendarError(400, "QUERY_LIMIT", "Reminder history exceeds 500 intents");
  const intents: BookingReminderIntent[] = history.map(({ intent, run, mapping, thread }) => ({ id: intent.id, revision: intent.revision,
    kind: intent.kind as BookingReminder["kind"], offsetMinutes: intent.offsetMinutes, scheduledFor: intent.scheduledFor.toISOString(),
    status: intent.acceptedAt ? run && !["queued", "running", "retrying"].includes(run.status) ? run.status : "accepted"
      : ["superseded", "skipped", "failed"].includes(intent.status) ? intent.status : run?.status ?? intent.status,
    reason: intent.reason ?? run?.error ?? null, acceptedAt: intent.acceptedAt?.toISOString() ?? null,
    runId: intent.acceptedAt && viewerId && thread?.userId === viewerId ? mapping?.agentRunId ?? null : null,
    threadId: intent.acceptedAt && viewerId && thread?.userId === viewerId && thread.workspaceId === booking.workspaceId ? thread.id : null }));
  return { bookingVersion: booking.version, revision: booking.revision, reminders: reminders.map(v => v.configuration), intents, complete: true as const };
}

/** SQL deadlines survive lost wakeups/restarts; Redis messages only wake existing workers. */
export async function dispatchDueBookingReminders(deps: CommandDependencies, now = deps.now(), limit = 25) {
  return deps.database.transaction(async tx => {
    const due = await tx.select().from(bookingReminderIntents).where(and(eq(bookingReminderIntents.status, "pending"), lte(bookingReminderIntents.scheduledFor, now)))
      .orderBy(asc(bookingReminderIntents.scheduledFor), asc(bookingReminderIntents.id)).limit(limit).for("update", { skipLocked: true });
    for (const intent of due) {
      const [booking] = await tx.select().from(bookings).where(eq(bookings.id, intent.bookingId));
      const [reminder] = await tx.select().from(bookingReminders).where(eq(bookingReminders.id, intent.reminderId));
      const [rule] = reminder ? await tx.select().from(automations).where(eq(automations.id, reminder.automationId)) : [];
      const stale = !booking || !reminder?.enabled || !rule || booking.revision !== intent.revision || booking.status !== "confirmed";
      const expired = booking && reminder && (intent.kind === "before_start" && now >= booking.start
        || +now > +intent.scheduledFor + reminder.configuration.maxLatenessMinutes * 60000);
      if (stale || expired) {
        await tx.update(bookingReminderIntents).set({ status: stale ? "superseded" : "skipped", reason: stale ? "booking_revision_changed" : "deadline_expired" }).where(eq(bookingReminderIntents.id, intent.id));
        continue;
      }
      const eventId = deps.uuid();
      await appendExternalAutomationEvent(deps, tx, { id: eventId, organizationId: rule!.organizationId, workspaceId: booking!.workspaceId,
        source: rule!.source, type: intent.kind === "before_start" ? "booking_reminder_due" : "booking_due", occurredAt: intent.scheduledFor.toISOString(), traceId: eventId,
        data: { intentId: intent.id, bookingId: booking!.id, revision: intent.revision, scheduledFor: intent.scheduledFor.toISOString(),
          booking: { id: booking!.id, title: booking!.title, start: booking!.start.toISOString(), end: booking!.end.toISOString(), timeZone: booking!.timeZone } } }, [rule as unknown as AutomationRule]);
      await tx.update(bookingReminderIntents).set({ status: "queued", eventId }).where(eq(bookingReminderIntents.id, intent.id));
    }
    return due.length;
  });
}

type Rejection = { status: "superseded" | "skipped" | "failed"; error: string };
/** Final acceptance boundary, inside the SAME transaction that accepts the native run.
 * Lock order: original key/member -> calendar -> stable person -> booking -> intent.
 * Cancellation/configuration follows calendar -> person -> booking -> intent too.
 * Accepted effects remain accepted after cancellation; recovery reads the stable mapping.
 */
export async function acceptBookingReminder(deps: RuntimeDependencies, tx: Transaction, runId: string, actorId: string): Promise<Rejection | undefined> {
  const [run] = await tx.select().from(automationRuns).where(eq(automationRuns.id, runId));
  const source = run?.ruleSnapshot?.source as AutomationRule["source"] | undefined;
  if (source?.kind !== "calendar") return;
  const [event] = run.eventId ? await tx.select().from(automationEvents).where(eq(automationEvents.id, run.eventId)) : [];
  if (!event) return { status: "failed", error: "invalid_reminder_event" };
  const snapshot = event?.snapshot as { protocol?: number; event?: { workspaceId?: string; data?: { intentId?: string } } } | undefined;
  const [reminder] = await tx.select().from(bookingReminders).where(eq(bookingReminders.id, source.reminderId));
  let authorized = !!reminder && reminder.createdByUserId === actorId;
  if (reminder?.keyId) {
    const [key] = await tx.select().from(userApiKeys).where(eq(userApiKeys.id, reminder.keyId)).for("share");
    const [grant] = await tx.select().from(apiKeyCalendars).where(and(eq(apiKeyCalendars.keyId, reminder.keyId), eq(apiKeyCalendars.calendarId, source.calendarId)));
    authorized = authorized && !!key && !key.revokedAt && key.userId === actorId && key.organizationId === event.organizationId && !!grant?.canTriggerAgent && !!grant.canUpdate;
  }
  const [owner] = await tx.select().from(member).where(and(eq(member.organizationId, event!.organizationId), eq(member.userId, actorId))).for("share");
  const [agent] = reminder ? await tx.select({ id: member.id }).from(member).innerJoin(agentProfile, eq(agentProfile.memberId, member.id))
    .where(and(eq(member.organizationId, event!.organizationId), eq(agentProfile.userId, reminder.configuration.agentUserId))).for("share", { of: member }) : [];
  authorized = authorized && !!owner && !!agent;
  const [calendar] = await tx.select().from(calendars).where(eq(calendars.id, source.calendarId)).for("share");
  const [initial] = await tx.select().from(bookings).where(eq(bookings.id, source.bookingId));
  const [person] = initial ? await tx.select().from(calendarPeople).where(eq(calendarPeople.id, initial.personId)).for("update") : [];
  const [booking] = await tx.select().from(bookings).where(eq(bookings.id, source.bookingId)).for("update");
  const [intent] = await tx.select().from(bookingReminderIntents).where(and(eq(bookingReminderIntents.reminderId, source.reminderId), eq(bookingReminderIntents.eventId, event!.id))).for("update");
  const reject = async (status: Rejection["status"], error: string) => {
    if (intent && !intent.acceptedAt) await tx.update(bookingReminderIntents).set({ status, reason: error }).where(eq(bookingReminderIntents.id, intent.id));
    return { status, error };
  };
  if (!event || snapshot?.protocol !== 3 || !calendar || calendar.archived || !person || person.archived || !booking || !intent || !reminder
    || snapshot.event?.data?.intentId !== intent.id || snapshot.event.workspaceId !== run.workspaceId
    || calendar.organizationId !== event.organizationId || calendar.workspaceId !== run.workspaceId
    || booking.calendarId !== source.calendarId || reminder.bookingId !== booking.id || reminder.automationId !== run.automationId
    || booking.workspaceId !== run.workspaceId || reminder.workspaceId !== run.workspaceId || intent.workspaceId !== run.workspaceId)
    return reject("failed", "invalid_reminder_scope");
  if (!authorized) return reject("failed", "reminder_authorization_revoked");
  if (!reminder.enabled || booking.status !== "confirmed" || booking.revision !== intent.revision || intent.status !== "queued")
    return reject("superseded", "booking_revision_changed");
  const now = deps.now();
  if (+now < +intent.scheduledFor) return reject("failed", "deadline_not_due");
  if (intent.kind === "before_start" && now >= booking.start || +now > +intent.scheduledFor + reminder.configuration.maxLatenessMinutes * 60000)
    return reject("skipped", "deadline_expired");
  await tx.update(bookingReminderIntents).set({ status: "accepted", acceptedAt: now }).where(eq(bookingReminderIntents.id, intent.id));
}
