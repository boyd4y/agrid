import { pgTable, uuid, text, jsonb, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { userApiKeys } from "@tabdo/auth/schema";
import { sites, siteRevisions } from "./sites-schema.js";
import { tables } from "./schema.js";
import { workspaces } from "./workspaces-schema.js";
export const apiKeyBlogs = pgTable("api_key_blogs", {
  keyId: uuid("key_id").notNull().references(() => userApiKeys.id, { onDelete: "cascade" }), tableId: uuid("table_id").notNull().references(() => tables.id, { onDelete: "cascade" }),
  canRead: boolean("can_read").notNull().default(false), canConfigure: boolean("can_configure").notNull().default(false), canBuild: boolean("can_build").notNull().default(false), canPublish: boolean("can_publish").notNull().default(false), canRestore: boolean("can_restore").notNull().default(false),
}, t => [uniqueIndex("api_key_blogs_scope_key").on(t.keyId, t.tableId)]);
/** A binary snapshot is retained with its revision before any storage upload begins.
 * Keys are deterministic, so a killed publisher can resume without untracked objects.
 */
export const blogAssetSnapshots = pgTable("blog_asset_snapshots", {
  revisionId: uuid("revision_id").notNull().references(() => siteRevisions.id, { onDelete: "cascade" }), path: text("path").notNull(),
  base64: text("base64").notNull(),
}, t => [uniqueIndex("blog_asset_snapshots_path_key").on(t.revisionId, t.path)]);
export const blogReceipts = pgTable("blog_receipts", {
  id: uuid("id").defaultRandom().primaryKey(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  principalId: text("principal_id").notNull(), command: text("command").notNull(), key: text("key").notNull(), requestHash: text("request_hash").notNull(), result: jsonb("result").$type<unknown>(),
}, t => [uniqueIndex("blog_receipts_request_key").on(t.workspaceId, t.principalId, t.command, t.key)]);
export const blogPreviews = pgTable("blog_previews", {
  token: text("token").primaryKey(), siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }), revisionId: uuid("revision_id").notNull().references(() => siteRevisions.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const blogPublicationPermits = pgTable("blog_publication_permits", {
  tokenHash: text("token_hash").primaryKey(), siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  intentHash: text("intent_hash").notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
/** Survives site deletion and process death; retried by the next blog operation. */
export const blogStorageGarbage = pgTable("blog_storage_garbage", {
  id: uuid("id").defaultRandom().primaryKey(), driver: text("driver").notNull(), keys: jsonb("keys").$type<string[]>().notNull(),
});
