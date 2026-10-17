import { calendarEventSchema } from "@tabdo/shared";
import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import type { CommandDependencies } from "../dependencies.js";
import type { Transaction } from "../db/types.js";
import { calendars, calendarSubscriptions, calendarDeliveries, calendarDeliveryAttempts, calendarEvents, member, userApiKeys, apiKeyCalendars } from "../db/schema.js";
import { decryptSecret } from "../integrations/secrets.js";

export type CalendarSendResult = { httpStatus: number | null; error: "destination_rejected" | "timeout" | "response_too_large" | "network_error" | "http_error" | "invalid_event" | null; permanent?: boolean };
export type CalendarOutbound = Readonly<{ encryptionKey: string; send(input: { endpoint: string; body: string; headers: Record<string, string> }): Promise<CalendarSendResult> }>;
const MAX_ATTEMPTS = 5, LEASE_MS = 60_000;
const BACKOFF_MS = [1000, 10_000, 60_000, 600_000];
type Delivery = typeof calendarDeliveries.$inferSelect;

export async function calendarSignature(secret: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
  return `t=${timestamp},v1=${Array.from(signed, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
export async function nextCalendarDeliveryDeadline(deps: CommandDependencies): Promise<Date | null> {
  const [row] = await deps.database.execute(sql`SELECT min(CASE WHEN status = 'pending' THEN next_attempt_at ELSE claim_until END) AS at FROM calendar_deliveries WHERE status IN ('pending','delivering') AND ${deps.workspaceId ? sql`workspace_id = ${deps.workspaceId}` : sql`true`}`);
  return row?.at ? new Date(row.at as string | Date) : null;
}

/** Lock order agrees with commands and Key management: identity -> calendars -> subscription -> delivery.
 * Hold the authorization locks through the bounded send, so revocation cannot commit before a new send starts.
 */
async function lockedDelivery(deps: CommandDependencies, tx: Transaction, candidate: Delivery) {
  const [initial] = await tx.select().from(calendarSubscriptions).where(eq(calendarSubscriptions.id, candidate.subscriptionId));
  if (!initial) return;
  const [scope] = await tx.select().from(calendars).where(eq(calendars.id, initial.calendarId));
  if (!scope) return;
  let authorized = true;
  if (initial.keyId) {
    const [key] = await tx.select().from(userApiKeys).where(eq(userApiKeys.id, initial.keyId)).for("share");
    const [grant] = key ? await tx.select().from(apiKeyCalendars).where(and(eq(apiKeyCalendars.keyId, key.id), eq(apiKeyCalendars.calendarId, initial.calendarId))) : [];
    authorized = !!key && !key.revokedAt && key.organizationId === scope.organizationId && key.userId === initial.createdByUserId && !!grant?.canRead && !!grant.canSubscribe;
  }
  const [creator] = await tx.select().from(member).where(and(eq(member.organizationId, scope.organizationId), eq(member.userId, initial.createdByUserId))).for("share");
  authorized &&= !!creator && (initial.keyId !== null || ["owner", "admin"].includes(creator.role));
  const [calendar] = await tx.select().from(calendars).where(and(eq(calendars.id, initial.calendarId), eq(calendars.workspaceId, candidate.workspaceId))).for("share");
  const [subscription] = await tx.select().from(calendarSubscriptions).where(eq(calendarSubscriptions.id, initial.id)).for("update");
  const [delivery] = await tx.select().from(calendarDeliveries).where(eq(calendarDeliveries.id, candidate.id)).for("update", { skipLocked: true });
  if (!delivery || !subscription || !calendar) return;
  authorized &&= calendar.workspaceId === subscription.workspaceId && delivery.calendarId === calendar.id && delivery.workspaceId === subscription.workspaceId;
  return { delivery, subscription, calendar, authorized };
}
async function skip(deps: CommandDependencies, tx: Transaction, delivery: Delivery, error: string) {
  await tx.update(calendarDeliveries).set({ status: "skipped", lastError: error, finishedAt: deps.now(), claimUntil: null, claimToken: null }).where(eq(calendarDeliveries.id, delivery.id));
  await tx.update(calendarDeliveryAttempts).set({ status: "unknown", error: "outcome_unknown", finishedAt: deps.now() }).where(and(eq(calendarDeliveryAttempts.deliveryId, delivery.id), eq(calendarDeliveryAttempts.status, "started")));
}
export async function dispatchCalendarDeliveries(deps: CommandDependencies, limit = 25) {
  const now = deps.now();
  const candidates = await deps.database.select().from(calendarDeliveries).where(and(deps.workspaceId ? eq(calendarDeliveries.workspaceId, deps.workspaceId) : undefined, or(and(eq(calendarDeliveries.status, "pending"), lte(calendarDeliveries.nextAttemptAt, now)), and(eq(calendarDeliveries.status, "delivering"), lte(calendarDeliveries.claimUntil, now)))))
    .orderBy(asc(calendarDeliveries.nextAttemptAt), asc(calendarDeliveries.id)).limit(limit);
  for (const candidate of candidates) {
    // Persist reservation before HTTP. A crashed process leaves a visible unknown attempt and a recoverable lease.
    const reserved = await deps.database.transaction(async tx => {
      const loaded = await lockedDelivery(deps, tx, candidate); if (!loaded) return;
      const { delivery, subscription, authorized } = loaded;
      if (delivery.status !== "pending" && delivery.status !== "delivering" || delivery.status === "pending" && delivery.nextAttemptAt > deps.now() || delivery.status === "delivering" && (!delivery.claimUntil || delivery.claimUntil > deps.now())) return;
      if (!authorized || subscription.status !== "active" || subscription.version !== delivery.subscriptionVersion) { await skip(deps, tx, delivery, authorized ? "subscription_changed" : "authorization_revoked"); return; }
      if (delivery.status === "delivering") await tx.update(calendarDeliveryAttempts).set({ status: "unknown", error: "outcome_unknown", finishedAt: deps.now() }).where(and(eq(calendarDeliveryAttempts.deliveryId, delivery.id), eq(calendarDeliveryAttempts.status, "started")));
      if (delivery.cycleAttempts >= MAX_ATTEMPTS) { await tx.update(calendarDeliveries).set({ status: "deadletter", lastError: "outcome_unknown", finishedAt: deps.now(), claimUntil: null, claimToken: null }).where(eq(calendarDeliveries.id, delivery.id)); return; }
      const token = deps.uuid(), attempt = delivery.attemptCount + 1;
      await tx.insert(calendarDeliveryAttempts).values({ id: deps.uuid(), deliveryId: delivery.id, attempt, startedAt: deps.now() });
      await tx.update(calendarDeliveries).set({ status: "delivering", attemptCount: attempt, cycleAttempts: delivery.cycleAttempts + 1, claimToken: token, claimUntil: new Date(+deps.now() + LEASE_MS) }).where(eq(calendarDeliveries.id, delivery.id));
      return { token, attempt };
    });
    if (!reserved) continue;
    await deps.database.transaction(async tx => {
      const loaded = await lockedDelivery(deps, tx, candidate); if (!loaded) return;
      const { delivery, subscription, calendar, authorized } = loaded;
      if (delivery.status !== "delivering" || delivery.claimToken !== reserved.token) return;
      if (!authorized || subscription.status !== "active" || subscription.version !== delivery.subscriptionVersion) { await skip(deps, tx, delivery, authorized ? "subscription_changed" : "authorization_revoked"); return; }
      const [event] = await tx.select().from(calendarEvents).where(and(eq(calendarEvents.id, delivery.eventId), eq(calendarEvents.calendarId, calendar.id), eq(calendarEvents.workspaceId, delivery.workspaceId)));
      let result: CalendarSendResult;
      const envelope = calendarEventSchema.safeParse(event?.envelope);
      if (!event || !envelope.success || envelope.data.eventId !== event.id || envelope.data.calendarId !== calendar.id || envelope.data.workspaceId !== delivery.workspaceId || envelope.data.aggregateId !== event.aggregateId || envelope.data.aggregateVersion !== event.aggregateVersion || envelope.data.type !== event.type) result = { httpStatus: null, error: "invalid_event", permanent: true };
      else {
        try {
          if (!deps.calendarOutbound) throw new Error("Unavailable");
          const secret = await decryptSecret(deps.calendarOutbound, subscription.encryptedSecret, { organizationId: calendar.organizationId, id: subscription.id, purpose: "calendar-signing" });
          const body = JSON.stringify({ ...envelope.data, deliveryId: delivery.id }), timestamp = String(Math.floor(+deps.now() / 1000));
          result = await deps.calendarOutbound.send({ endpoint: subscription.endpoint, body, headers: { "Content-Type": "application/json", "X-Tabdo-Event-Id": event.id, "X-Tabdo-Delivery-Id": delivery.id, "X-Tabdo-Signature": await calendarSignature(secret, timestamp, body) } });
        } catch { result = { httpStatus: null, error: "network_error" }; }
      }
      const succeeded = result.error === null && result.httpStatus !== null && result.httpStatus >= 200 && result.httpStatus < 300;
      const exhausted = !succeeded && (result.permanent || delivery.cycleAttempts >= MAX_ATTEMPTS);
      const status = succeeded ? "succeeded" : exhausted ? "deadletter" : "pending";
      const error = succeeded ? null : result.error ?? "http_error";
      await tx.update(calendarDeliveryAttempts).set({ status: succeeded ? "succeeded" : "failed", error, httpStatus: result.httpStatus, finishedAt: deps.now() }).where(and(eq(calendarDeliveryAttempts.deliveryId, delivery.id), eq(calendarDeliveryAttempts.attempt, reserved.attempt)));
      await tx.update(calendarDeliveries).set({ status, lastError: error, httpStatus: result.httpStatus, claimUntil: null, claimToken: null, finishedAt: status === "pending" ? null : deps.now(), nextAttemptAt: new Date(+deps.now() + (BACKOFF_MS[delivery.cycleAttempts - 1] ?? 600_000)) }).where(eq(calendarDeliveries.id, delivery.id));
    });
  }
  return candidates.length;
}
