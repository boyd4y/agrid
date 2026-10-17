import { sql } from "drizzle-orm";
import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "@tabdo/auth/schema";

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("workspaces_scope_key").on(t.id, t.organizationId), index("workspaces_org_idx").on(t.organizationId),
  uniqueIndex("workspaces_default_idx").on(t.organizationId).where(sql`${t.isDefault} = true`)]);

/** NULL is filled and validated by the database trigger for legacy seed callers. */
export const workspaceColumn = () => uuid("workspace_id").notNull().default(sql`NULL`).references(() => workspaces.id, { onDelete: "cascade" });
