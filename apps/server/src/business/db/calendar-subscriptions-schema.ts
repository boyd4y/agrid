import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, jsonb, index, uniqueIndex, foreignKey, check } from "drizzle-orm/pg-core";
import { user } from "@tabdo/auth/schema";
import { calendars } from "./calendar-schema.js";
import type { CalendarEvent, CalendarEventType, CalendarDeliveryStatus, CalendarDeliveryAttempt } from "@tabdo/shared";

export const calendarEvents = pgTable("calendar_events", {
  id: uuid("id").defaultRandom().primaryKey(), workspaceId: uuid("workspace_id").notNull(), calendarId: uuid("calendar_id").notNull(),
  type: text("type").$type<CalendarEventType>().notNull(), aggregateId: uuid("aggregate_id").notNull(), aggregateVersion: integer("aggregate_version").notNull(),
  envelope: jsonb("envelope").$type<CalendarEvent>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [foreignKey({ columns: [t.calendarId, t.workspaceId], foreignColumns: [calendars.id, calendars.workspaceId] }).onDelete("cascade"),
  uniqueIndex("calendar_events_scope_key").on(t.id, t.calendarId, t.workspaceId), uniqueIndex("calendar_events_version_key").on(t.calendarId, t.aggregateId, t.aggregateVersion, t.type),
  index("calendar_events_calendar_idx").on(t.calendarId, t.createdAt), check("calendar_events_version", sql`${t.aggregateVersion} > 0`)]);
export const calendarSubscriptions = pgTable("calendar_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(), workspaceId: uuid("workspace_id").notNull(), calendarId: uuid("calendar_id").notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  // Deliberately not an FK: deleting a Key must never turn its subscription into a member-owned one.
  keyId: uuid("key_id"), name: text("name").notNull(), endpoint: text("endpoint").notNull(), eventTypes: jsonb("event_types").$type<CalendarEventType[]>().notNull(),
  status: text("status").$type<"active" | "paused" | "revoked">().notNull().default("active"), version: integer("version").notNull().default(1),
  encryptedSecret: jsonb("encrypted_secret").$type<Record<string, string>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [foreignKey({ columns: [t.calendarId, t.workspaceId], foreignColumns: [calendars.id, calendars.workspaceId] }).onDelete("cascade"),
  uniqueIndex("calendar_subscriptions_scope_key").on(t.id, t.calendarId, t.workspaceId), index("calendar_subscriptions_calendar_idx").on(t.calendarId),
  check("calendar_subscriptions_status", sql`${t.status} IN ('active','paused','revoked')`), check("calendar_subscriptions_version", sql`${t.version} > 0`)]);
export const calendarDeliveries = pgTable("calendar_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(), workspaceId: uuid("workspace_id").notNull(), calendarId: uuid("calendar_id").notNull(),
  subscriptionId: uuid("subscription_id").notNull(), eventId: uuid("event_id").notNull(), subscriptionVersion: integer("subscription_version").notNull(),
  status: text("status").$type<CalendarDeliveryStatus>().notNull().default("pending"), attemptCount: integer("attempt_count").notNull().default(0), cycleAttempts: integer("cycle_attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(), claimUntil: timestamp("claim_until", { withTimezone: true }), claimToken: uuid("claim_token"),
  lastError: text("last_error"), httpStatus: integer("http_status"), finishedAt: timestamp("finished_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [foreignKey({ columns: [t.subscriptionId, t.calendarId, t.workspaceId], foreignColumns: [calendarSubscriptions.id, calendarSubscriptions.calendarId, calendarSubscriptions.workspaceId] }).onDelete("cascade"),
  foreignKey({ columns: [t.eventId, t.calendarId, t.workspaceId], foreignColumns: [calendarEvents.id, calendarEvents.calendarId, calendarEvents.workspaceId] }).onDelete("cascade"),
  uniqueIndex("calendar_deliveries_event_key").on(t.subscriptionId, t.eventId), index("calendar_deliveries_page_idx").on(t.subscriptionId, t.id),
  index("calendar_deliveries_due_idx").on(t.nextAttemptAt).where(sql`${t.status} = 'pending'`), index("calendar_deliveries_lease_idx").on(t.claimUntil).where(sql`${t.status} = 'delivering'`),
  check("calendar_deliveries_status", sql`${t.status} IN ('pending','delivering','succeeded','deadletter','skipped')`)]);
export const calendarDeliveryAttempts = pgTable("calendar_delivery_attempts", {
  id: uuid("id").defaultRandom().primaryKey(), deliveryId: uuid("delivery_id").notNull().references(() => calendarDeliveries.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(), status: text("status").$type<CalendarDeliveryAttempt["status"]>().notNull().default("started"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(), finishedAt: timestamp("finished_at", { withTimezone: true }), httpStatus: integer("http_status"), error: text("error"),
}, t => [uniqueIndex("calendar_delivery_attempts_number_key").on(t.deliveryId, t.attempt), check("calendar_delivery_attempts_status", sql`${t.status} IN ('started','succeeded','failed','unknown','skipped')`)]);
