import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, jsonb, boolean, uniqueIndex, foreignKey, check } from "drizzle-orm/pg-core";
import { userApiKeys } from "@tabdo/auth/schema";
import { tables, rows } from "./schema.js";
import { workspaces } from "./workspaces-schema.js";
import type { DocumentContent } from "@tabdo/shared";

// Source IDs survive record/table deletion; only the live link is cascaded away.
export const recordDocuments = pgTable("record_documents", {
  id: uuid("id").defaultRandom().primaryKey(), organizationId: text("organization_id").notNull(), workspaceId: uuid("workspace_id").notNull(),
  sourceTableId: uuid("source_table_id").notNull(), sourceRowId: uuid("source_row_id").notNull(),
  version: integer("version").notNull().default(1), schemaVersion: integer("schema_version").notNull().default(1),
  content: jsonb("content").$type<DocumentContent>().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("record_documents_row_key").on(t.sourceRowId), uniqueIndex("record_documents_scope_key").on(t.id, t.sourceRowId, t.sourceTableId, t.workspaceId, t.organizationId),
  foreignKey({ name: "record_documents_workspace_scope_fk", columns: [t.workspaceId, t.organizationId], foreignColumns: [workspaces.id, workspaces.organizationId] }).onDelete("cascade"),
  check("record_documents_version_check", sql`${t.version} > 0 AND ${t.schemaVersion} = 1`)]);
export const recordDocumentLinks = pgTable("record_document_links", {
  documentId: uuid("document_id").primaryKey(), rowId: uuid("row_id").notNull(), tableId: uuid("table_id").notNull(), workspaceId: uuid("workspace_id").notNull(), organizationId: text("organization_id").notNull(),
}, t => [uniqueIndex("record_document_links_row_key").on(t.rowId),
  foreignKey({ name: "record_document_links_document_scope_fk", columns: [t.documentId, t.rowId, t.tableId, t.workspaceId, t.organizationId], foreignColumns: [recordDocuments.id, recordDocuments.sourceRowId, recordDocuments.sourceTableId, recordDocuments.workspaceId, recordDocuments.organizationId] }).onDelete("cascade"),
  foreignKey({ name: "record_document_links_row_scope_fk", columns: [t.rowId, t.tableId], foreignColumns: [rows.id, rows.tableId] }).onDelete("cascade"),
  foreignKey({ name: "record_document_links_table_scope_fk", columns: [t.tableId, t.workspaceId, t.organizationId], foreignColumns: [tables.id, tables.workspaceId, tables.organizationId] }).onDelete("cascade")]);
export const documentRevisions = pgTable("document_revisions", {
  documentId: uuid("document_id").notNull().references(() => recordDocuments.id, { onDelete: "cascade" }), version: integer("version").notNull(),
  content: jsonb("content").$type<DocumentContent>().notNull(), restoredFrom: integer("restored_from"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("document_revisions_version_key").on(t.documentId, t.version)]);
export const documentReceipts = pgTable("document_receipts", {
  id: uuid("id").defaultRandom().primaryKey(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  principalId: text("principal_id").notNull(), command: text("command").notNull(), key: text("key").notNull(), requestHash: text("request_hash").notNull(), result: jsonb("result").$type<unknown>(),
}, t => [uniqueIndex("document_receipts_request_key").on(t.workspaceId, t.principalId, t.command, t.key)]);
export const documentImages = pgTable("document_images", {
  id: uuid("id").primaryKey(), documentId: uuid("document_id").notNull().references(() => recordDocuments.id, { onDelete: "cascade" }),
  name: text("name").notNull(), mimeType: text("mime_type").notNull(), size: integer("size").notNull(),
  storageDriver: text("storage_driver").$type<"local" | "s3">().notNull(), storageKey: text("storage_key").notNull(),
}, t => [uniqueIndex("document_images_storage_key").on(t.storageDriver, t.storageKey)]);
export const apiKeyDocuments = pgTable("api_key_documents", {
  keyId: uuid("key_id").notNull().references(() => userApiKeys.id, { onDelete: "cascade" }), tableId: uuid("table_id").notNull().references(() => tables.id, { onDelete: "cascade" }),
  canRead: boolean("can_read").notNull().default(false), canCreate: boolean("can_create").notNull().default(false), canUpdate: boolean("can_update").notNull().default(false),
  canReadHistory: boolean("can_read_history").notNull().default(false), canRestore: boolean("can_restore").notNull().default(false), canUpload: boolean("can_upload").notNull().default(false),
}, t => [uniqueIndex("api_key_documents_key_table_key").on(t.keyId, t.tableId), check("api_key_documents_capability", sql`${t.canRead} OR ${t.canCreate} OR ${t.canUpdate} OR ${t.canReadHistory} OR ${t.canRestore} OR ${t.canUpload}`)]);
