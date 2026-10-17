CREATE TABLE "api_key_documents" (
	"key_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"can_read" boolean DEFAULT false NOT NULL,
	"can_create" boolean DEFAULT false NOT NULL,
	"can_update" boolean DEFAULT false NOT NULL,
	"can_read_history" boolean DEFAULT false NOT NULL,
	"can_restore" boolean DEFAULT false NOT NULL,
	"can_upload" boolean DEFAULT false NOT NULL,
	CONSTRAINT "api_key_documents_capability" CHECK ("api_key_documents"."can_read" OR "api_key_documents"."can_create" OR "api_key_documents"."can_update" OR "api_key_documents"."can_read_history" OR "api_key_documents"."can_restore" OR "api_key_documents"."can_upload")
);
--> statement-breakpoint
CREATE TABLE "document_images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_driver" text NOT NULL,
	"storage_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"principal_id" text NOT NULL,
	"command" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "document_revisions" (
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"restored_from" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_document_links" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"row_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"organization_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_table_id" uuid NOT NULL,
	"source_row_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"content" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_documents_version_check" CHECK ("record_documents"."version" > 0 AND "record_documents"."schema_version" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_documents_key_table_key" ON "api_key_documents" USING btree ("key_id","table_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "document_images_storage_key" ON "document_images" USING btree ("storage_driver","storage_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "document_receipts_request_key" ON "document_receipts" USING btree ("workspace_id","principal_id","command","key");
--> statement-breakpoint
CREATE UNIQUE INDEX "document_revisions_version_key" ON "document_revisions" USING btree ("document_id","version");
--> statement-breakpoint
CREATE UNIQUE INDEX "record_document_links_row_key" ON "record_document_links" USING btree ("row_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "record_documents_row_key" ON "record_documents" USING btree ("source_row_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "record_documents_scope_key" ON "record_documents" USING btree ("id","source_row_id","source_table_id","workspace_id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "rows_scope_key" ON "rows" USING btree ("id","table_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tables_scope_key" ON "tables" USING btree ("id","workspace_id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_scope_key" ON "workspaces" USING btree ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "api_key_documents" ADD CONSTRAINT "api_key_documents_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_key_documents" ADD CONSTRAINT "api_key_documents_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_images" ADD CONSTRAINT "document_images_document_id_record_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."record_documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_receipts" ADD CONSTRAINT "document_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_document_id_record_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."record_documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "record_document_links" ADD CONSTRAINT "record_document_links_document_scope_fk" FOREIGN KEY ("document_id","row_id","table_id","workspace_id","organization_id") REFERENCES "public"."record_documents"("id","source_row_id","source_table_id","workspace_id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "record_document_links" ADD CONSTRAINT "record_document_links_row_scope_fk" FOREIGN KEY ("row_id","table_id") REFERENCES "public"."rows"("id","table_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "record_document_links" ADD CONSTRAINT "record_document_links_table_scope_fk" FOREIGN KEY ("table_id","workspace_id","organization_id") REFERENCES "public"."tables"("id","workspace_id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "record_documents" ADD CONSTRAINT "record_documents_workspace_scope_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION tabdo_document_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Document revisions are immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER document_revisions_immutable BEFORE UPDATE ON document_revisions FOR EACH ROW EXECUTE FUNCTION tabdo_document_revision_immutable();
