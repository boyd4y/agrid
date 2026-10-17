import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, jsonb, boolean, index, uniqueIndex, foreignKey, check } from "drizzle-orm/pg-core";
import { organization, user, userApiKeys } from "@tabdo/auth/schema";
import { workspaces } from "./workspaces-schema.js";
import type { WorkingWindow } from "@tabdo/shared";

export const calendars = pgTable("calendars", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(), timeZone: text("time_zone").notNull(),
  version: integer("version").notNull().default(1), archived: boolean("archived").notNull().default(false),
}, t => [uniqueIndex("calendars_scope_key").on(t.id, t.workspaceId), index("calendars_workspace_idx").on(t.workspaceId)]);
export const calendarPeople = pgTable("calendar_people", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(), timeZone: text("time_zone").notNull(),
  // Restrict deletion so a bound identity cannot disappear and reopen its old slot under a new ID.
  userId: text("user_id").references(() => user.id, { onDelete: "restrict" }),
  windows: jsonb("windows").$type<WorkingWindow[]>().notNull().default([]),
  version: integer("version").notNull().default(1), archived: boolean("archived").notNull().default(false),
}, t => [uniqueIndex("calendar_people_scope_key").on(t.id, t.workspaceId), uniqueIndex("calendar_people_bound_user_key").on(t.workspaceId, t.userId), index("calendar_people_workspace_idx").on(t.workspaceId)]);
export const availabilityExceptions = pgTable("availability_exceptions", {
  id: uuid("id").defaultRandom().primaryKey(), personId: uuid("person_id").notNull().references(() => calendarPeople.id, { onDelete: "cascade" }),
  date: text("date").notNull(), intervals: jsonb("intervals").$type<{ start: string; end: string }[]>().notNull(),
  version: integer("version").notNull().default(1),
}, t => [index("availability_exceptions_person_date_idx").on(t.personId, t.date)]);
export const bookings = pgTable("bookings", {
  id: uuid("id").defaultRandom().primaryKey(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  calendarId: uuid("calendar_id").notNull(), personId: uuid("person_id").notNull(), title: text("title").notNull(),
  start: timestamp("start", { withTimezone: true }).notNull(), end: timestamp("end", { withTimezone: true }).notNull(), timeZone: text("time_zone").notNull(),
  status: text("status").$type<"confirmed" | "cancelled">().notNull().default("confirmed"), version: integer("version").notNull().default(1), revision: integer("revision").notNull().default(1),
  // A reference only; ordinary row CRUD never owns booking state. Resolve it under live table grants.
  linkedRowId: uuid("linked_row_id"),
}, t => [foreignKey({ columns: [t.calendarId, t.workspaceId], foreignColumns: [calendars.id, calendars.workspaceId] }).onDelete("cascade"),
  foreignKey({ columns: [t.personId, t.workspaceId], foreignColumns: [calendarPeople.id, calendarPeople.workspaceId] }).onDelete("cascade"),
  index("bookings_person_range_idx").on(t.personId, t.start, t.end), index("bookings_calendar_range_idx").on(t.calendarId, t.start, t.id),
  check("bookings_time_check", sql`${t.end} > ${t.start}`), check("bookings_status_check", sql`${t.status} IN ('confirmed', 'cancelled')`)]);
export const calendarReceipts = pgTable("calendar_receipts", {
  id: uuid("id").defaultRandom().primaryKey(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  principalId: text("principal_id").notNull(), command: text("command").notNull(), key: text("key").notNull(), requestHash: text("request_hash").notNull(),
  result: jsonb("result").$type<unknown>(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("calendar_receipts_request_key").on(t.workspaceId, t.principalId, t.command, t.key)]);
export const apiKeyCalendars = pgTable("api_key_calendars", {
  keyId: uuid("key_id").notNull().references(() => userApiKeys.id, { onDelete: "cascade" }), calendarId: uuid("calendar_id").notNull().references(() => calendars.id, { onDelete: "cascade" }),
  canRead: boolean("can_read").notNull().default(false), canReadAvailability: boolean("can_read_availability").notNull().default(false),
  canCreate: boolean("can_create").notNull().default(false), canUpdate: boolean("can_update").notNull().default(false), canCancel: boolean("can_cancel").notNull().default(false), canManage: boolean("can_manage").notNull().default(false),
}, t => [uniqueIndex("api_key_calendars_key_calendar_idx").on(t.keyId, t.calendarId), check("api_key_calendars_capability", sql`${t.canRead} OR ${t.canReadAvailability} OR ${t.canCreate} OR ${t.canUpdate} OR ${t.canCancel} OR ${t.canManage}`)]);
