import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { CalendarEvent, CalendarEventType, CalendarSubscription, CalendarDelivery, CalendarSubscriptionPage } from "@tabdo/shared";
import type { CommandDependencies, RuntimeDependencies } from "../dependencies.js";
import type { Transaction } from "../db/types.js";
import { calendars, calendarEvents, calendarSubscriptions, calendarDeliveries, calendarDeliveryAttempts } from "../db/schema.js";
import { encryptSecret, secretToken } from "../integrations/secrets.js";
import { CalendarError } from "./errors.js";

type Subscription = typeof calendarSubscriptions.$inferSelect;
async function encryptSigningSecret(deps: CommandDependencies, organizationId: string, id: string, secret: string) {
  try { return await encryptSecret(deps.calendarOutbound!, secret, { organizationId, id, purpose: "calendar-signing" }); }
  catch { throw new CalendarError(503, "SERVICE_UNAVAILABLE", "Calendar signing encryption is not configured"); }
}

export const publicSubscription = (value: Subscription): CalendarSubscription => ({ id: value.id, workspaceId: value.workspaceId, calendarId: value.calendarId, name: value.name, endpoint: value.endpoint, eventTypes: value.eventTypes, status: value.status, version: value.version, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() });
export const publicDelivery = (value: typeof calendarDeliveries.$inferSelect, event: CalendarEvent): CalendarDelivery => ({ id: value.id, subscriptionId: value.subscriptionId, subscriptionVersion: value.subscriptionVersion, event, status: value.status, attemptCount: value.attemptCount, nextAttemptAt: value.nextAttemptAt.toISOString(), lastError: value.lastError, httpStatus: value.httpStatus, finishedAt: value.finishedAt?.toISOString() ?? null, createdAt: value.createdAt.toISOString() });
function page<T extends { id: string }>(rows: T[], limit: number): CalendarSubscriptionPage<T> { const hasMore = rows.length > limit, items = rows.slice(0, limit); return { items, hasMore, nextCursor: hasMore ? items.at(-1)!.id : null, limit }; }
export async function skipSubscriptionDeliveries(deps: Pick<RuntimeDependencies, "now">, tx: Transaction, subscriptionId: string, reason = "subscription_changed") {
  await tx.update(calendarDeliveries).set({ status: "skipped", lastError: reason, finishedAt: deps.now(), claimUntil: null, claimToken: null })
    .where(and(eq(calendarDeliveries.subscriptionId, subscriptionId), inArray(calendarDeliveries.status, ["pending", "delivering"])));
  // A crashed sender may already have reached the receiver. Revocation must not rewrite that uncertainty as "never sent".
  await tx.update(calendarDeliveryAttempts).set({ status: "unknown", error: "outcome_unknown", finishedAt: deps.now() }).where(and(
    inArray(calendarDeliveryAttempts.deliveryId, tx.select({ id: calendarDeliveries.id }).from(calendarDeliveries).where(eq(calendarDeliveries.subscriptionId, subscriptionId))), eq(calendarDeliveryAttempts.status, "started")));
}

/** Called only inside the calendar command transaction, after live authorization. */
export async function subscriptionCommand(deps: CommandDependencies, tx: Transaction, command: string, input: Record<string, any>, context: { calendar: typeof calendars.$inferSelect; actorId: string; keyId: string | null }) {
  const { calendar, actorId, keyId } = context;
  const scope = and(eq(calendarSubscriptions.calendarId, calendar.id), eq(calendarSubscriptions.workspaceId, calendar.workspaceId), keyId ? eq(calendarSubscriptions.keyId, keyId) : undefined);
  const load = async () => {
    const [found] = await tx.select().from(calendarSubscriptions).where(and(scope, eq(calendarSubscriptions.id, input.subscriptionId))).for("update");
    if (!found) throw new CalendarError(404, "NOT_FOUND", "Subscription not found"); return found;
  };
  if (command === "listCalendarSubscriptions") return page((await tx.select().from(calendarSubscriptions).where(and(scope, input.cursor ? gt(calendarSubscriptions.id, input.cursor) : undefined)).orderBy(asc(calendarSubscriptions.id)).limit(input.limit + 1)).map(publicSubscription), input.limit);
  if (command === "createCalendarSubscription") {
    if (calendar.archived) throw new CalendarError(409, "ARCHIVED", "The calendar is archived");
    const [count] = await tx.select({ total: sql<number>`count(*)::integer` }).from(calendarSubscriptions).where(and(eq(calendarSubscriptions.calendarId, calendar.id), sql`${calendarSubscriptions.status} <> 'revoked'`));
    if (count.total >= 100) throw new CalendarError(400, "QUERY_LIMIT", "At most 100 non-revoked subscriptions per calendar");
    if (!deps.calendarOutbound) throw new CalendarError(503, "SERVICE_UNAVAILABLE", "Calendar outbound delivery is not configured");
    const id = deps.uuid(), secret = secretToken("cal_whsec_");
    const encryptedSecret = await encryptSigningSecret(deps, calendar.organizationId, id, secret);
    const [saved] = await tx.insert(calendarSubscriptions).values({ id, workspaceId: calendar.workspaceId, calendarId: calendar.id, createdByUserId: actorId, keyId, name: input.name, endpoint: input.endpoint, eventTypes: input.eventTypes, encryptedSecret, createdAt: deps.now(), updatedAt: deps.now() }).returning();
    return { subscription: publicSubscription(saved), secret };
  }
  const subscription = await load();
  if (command === "getCalendarSubscription") return publicSubscription(subscription);
  if (["listCalendarDeliveries", "getCalendarDelivery", "retryCalendarDelivery"].includes(command)) {
    const deliveryScope = and(eq(calendarDeliveries.subscriptionId, subscription.id), eq(calendarDeliveries.calendarId, calendar.id), eq(calendarDeliveries.workspaceId, calendar.workspaceId));
    if (command === "listCalendarDeliveries") {
      const found = await tx.select({ delivery: calendarDeliveries, event: calendarEvents.envelope }).from(calendarDeliveries).innerJoin(calendarEvents, eq(calendarEvents.id, calendarDeliveries.eventId))
        .where(and(deliveryScope, input.cursor ? gt(calendarDeliveries.id, input.cursor) : undefined, input.status ? eq(calendarDeliveries.status, input.status) : undefined)).orderBy(asc(calendarDeliveries.id)).limit(input.limit + 1);
      return page(found.map(v => publicDelivery(v.delivery, v.event)), input.limit);
    }
    const [found] = await tx.select().from(calendarDeliveries).where(and(deliveryScope, eq(calendarDeliveries.id, input.deliveryId))).for("update");
    if (!found) throw new CalendarError(404, "NOT_FOUND", "Delivery not found");
    const [event] = await tx.select().from(calendarEvents).where(eq(calendarEvents.id, found.eventId));
    if (command === "getCalendarDelivery") {
      const attempts = await tx.select().from(calendarDeliveryAttempts).where(eq(calendarDeliveryAttempts.deliveryId, found.id)).orderBy(asc(calendarDeliveryAttempts.attempt));
      return { delivery: publicDelivery(found, event.envelope), attempts: attempts.map(({ deliveryId: _, ...attempt }) => ({ ...attempt, startedAt: attempt.startedAt.toISOString(), finishedAt: attempt.finishedAt?.toISOString() ?? null })) };
    }
    if (subscription.version !== input.expectedVersion) throw new CalendarError(409, "VERSION_CONFLICT", "Subscription changed");
    if (calendar.archived || subscription.status !== "active" || subscription.version !== found.subscriptionVersion || found.status !== "deadletter") throw new CalendarError(409, "INVALID_STATE", "Only a current active subscription's deadletter can be retried");
    const [saved] = await tx.update(calendarDeliveries).set({ status: "pending", cycleAttempts: 0, nextAttemptAt: deps.now(), finishedAt: null, lastError: null, httpStatus: null }).where(eq(calendarDeliveries.id, found.id)).returning();
    deps.wakeAfterCommit?.(tx, { kind: "calendar-deliveries" });
    return publicDelivery(saved, event.envelope);
  }
  if (subscription.version !== input.expectedVersion) throw new CalendarError(409, "VERSION_CONFLICT", "Subscription changed");
  if (subscription.status === "revoked") throw new CalendarError(409, "INVALID_STATE", "A revoked subscription cannot be changed");
  if (calendar.archived && command === "updateCalendarSubscription" && input.status === "active") throw new CalendarError(409, "ARCHIVED", "The calendar is archived");
  let secret: string | undefined;
  const change: Partial<Subscription> = { version: subscription.version + 1, updatedAt: deps.now() };
  if (command === "updateCalendarSubscription") Object.assign(change, { name: input.name, endpoint: input.endpoint, eventTypes: input.eventTypes, status: input.status });
  else if (command === "revokeCalendarSubscription") change.status = "revoked";
  else if (command === "rotateCalendarSubscriptionSecret") {
    if (!deps.calendarOutbound) throw new CalendarError(503, "SERVICE_UNAVAILABLE", "Calendar outbound delivery is not configured");
    secret = secretToken("cal_whsec_");
    change.encryptedSecret = await encryptSigningSecret(deps, calendar.organizationId, subscription.id, secret);
  } else throw new CalendarError(400, "BAD_INPUT", "Unknown subscription command");
  const [saved] = await tx.update(calendarSubscriptions).set(change).where(eq(calendarSubscriptions.id, subscription.id)).returning();
  await skipSubscriptionDeliveries(deps, tx, saved.id);
  return secret ? { subscription: publicSubscription(saved), secret } : publicSubscription(saved);
}

/** Journal + per-subscription SQL outbox share the booking/configuration transaction. */
export async function appendCalendarEvent(deps: CommandDependencies, tx: Transaction, calendarId: string, workspaceId: string, type: CalendarEventType, aggregateId: string, aggregateVersion: number) {
  const envelope: CalendarEvent = { protocol: 1, eventId: deps.uuid(), workspaceId, calendarId, type, aggregateId, aggregateVersion, occurredAt: deps.now().toISOString() };
  await tx.insert(calendarEvents).values({ id: envelope.eventId, calendarId, workspaceId, type, aggregateId, aggregateVersion, envelope, createdAt: deps.now() });
  const subscribers = await tx.select().from(calendarSubscriptions).where(and(eq(calendarSubscriptions.calendarId, calendarId), eq(calendarSubscriptions.workspaceId, workspaceId), eq(calendarSubscriptions.status, "active")));
  const targets = subscribers.filter(s => s.eventTypes.includes(type));
  if (targets.length) {
    await tx.insert(calendarDeliveries).values(targets.map(s => ({ id: deps.uuid(), workspaceId, calendarId, subscriptionId: s.id, subscriptionVersion: s.version, eventId: envelope.eventId, nextAttemptAt: deps.now(), createdAt: deps.now() })));
    deps.wakeAfterCommit?.(tx, { kind: "calendar-deliveries" });
  }
}

/** Permission narrowing is durable even if the grant is restored before a worker wakes. */
export async function suspendKeySubscriptions(deps: RuntimeDependencies, tx: Transaction, keyId: string, permittedCalendars: string[]) {
  const candidates = await tx.select().from(calendarSubscriptions).where(and(eq(calendarSubscriptions.keyId, keyId), sql`${calendarSubscriptions.status} <> 'revoked'`));
  const affected = candidates.filter(s => !permittedCalendars.includes(s.calendarId));
  if (!affected.length) return;
  await tx.select({ id: calendars.id }).from(calendars).where(inArray(calendars.id, affected.map(s => s.calendarId))).orderBy(asc(calendars.id)).for("share");
  for (const subscription of affected.sort((a, b) => a.id.localeCompare(b.id))) {
    await tx.update(calendarSubscriptions).set({ status: "paused", version: sql`${calendarSubscriptions.version} + 1`, updatedAt: deps.now() }).where(eq(calendarSubscriptions.id, subscription.id));
    await skipSubscriptionDeliveries(deps, tx, subscription.id, "authorization_revoked");
  }
}

/** Take old and new target locks together, before Key edits acquire a partial set in a different order. */
export async function lockSubscriptionCalendarsForKey(tx: Transaction, organizationId: string, keyId: string, newCalendarIds: string[]) {
  const owned = await tx.select({ calendarId: calendarSubscriptions.calendarId }).from(calendarSubscriptions).where(and(eq(calendarSubscriptions.keyId, keyId), sql`${calendarSubscriptions.status} <> 'revoked'`));
  const ids = [...new Set([...newCalendarIds, ...owned.map(s => s.calendarId)])].sort();
  if (ids.length) await tx.select({ id: calendars.id }).from(calendars).where(and(eq(calendars.organizationId, organizationId), inArray(calendars.id, ids))).orderBy(asc(calendars.id)).for("share");
}
