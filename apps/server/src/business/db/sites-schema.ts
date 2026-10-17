import { workspaceColumn } from "./workspaces-schema.js";
import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { organization, user } from "@tabdo/auth/schema";
import type { SiteSourceFile, BlogConfig, BlogManifest } from "@tabdo/shared";

export const sites = pgTable("sites", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  workspaceId: workspaceColumn(),
  kind: text("kind").$type<"code" | "blog">().notNull().default("code"),
  blogConfig: jsonb("blog_config").$type<BlogConfig>(),
  name: text("name").notNull(), version: integer("version").notNull().default(1),
  publishedRevisionId: uuid("published_revision_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("sites_org_updated_idx").on(t.organizationId, t.updatedAt), index("sites_workspace_updated_idx").on(t.workspaceId, t.updatedAt)]);
export const siteRevisions = pgTable("site_revisions", {
  id: uuid("id").defaultRandom().primaryKey(), siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  version: integer("version").notNull(), files: jsonb("files").$type<SiteSourceFile[]>().notNull(),
  blogConfig: jsonb("blog_config").$type<BlogConfig>(), blogManifest: jsonb("blog_manifest").$type<BlogManifest>(),
  assets: jsonb("assets").$type<Record<string, string>>(), storageDriver: text("storage_driver"),
  createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("site_revisions_version_idx").on(t.siteId, t.version)]);
/** Short-lived, mutable editor previews never appear in version history or publication. */
export const sitePreviews = pgTable("site_previews", {
  id: uuid("id").defaultRandom().primaryKey(), siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  token: text("token").notNull(), files: jsonb("files").$type<SiteSourceFile[]>().notNull(),
  generation: integer("generation").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [uniqueIndex("site_previews_token_idx").on(t.token), index("site_previews_expiry_idx").on(t.expiresAt)]);
