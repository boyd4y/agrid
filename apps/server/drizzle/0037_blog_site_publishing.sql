CREATE TABLE "api_key_blogs" (
	"key_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"can_read" boolean DEFAULT false NOT NULL,
	"can_configure" boolean DEFAULT false NOT NULL,
	"can_build" boolean DEFAULT false NOT NULL,
	"can_publish" boolean DEFAULT false NOT NULL,
	"can_restore" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blog_asset_snapshots" (
	"revision_id" uuid NOT NULL,
	"path" text NOT NULL,
	"base64" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blog_previews" (
	"token" text PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blog_publication_permits" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"intent_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blog_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"principal_id" text NOT NULL,
	"command" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "blog_storage_garbage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver" text NOT NULL,
	"keys" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_revisions" ADD COLUMN "blog_config" jsonb;--> statement-breakpoint
ALTER TABLE "site_revisions" ADD COLUMN "blog_manifest" jsonb;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "kind" text DEFAULT 'code' NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "blog_config" jsonb;--> statement-breakpoint
ALTER TABLE "api_key_blogs" ADD CONSTRAINT "api_key_blogs_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_blogs" ADD CONSTRAINT "api_key_blogs_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_asset_snapshots" ADD CONSTRAINT "blog_asset_snapshots_revision_id_site_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."site_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_previews" ADD CONSTRAINT "blog_previews_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_previews" ADD CONSTRAINT "blog_previews_revision_id_site_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."site_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_publication_permits" ADD CONSTRAINT "blog_publication_permits_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_receipts" ADD CONSTRAINT "blog_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_blogs_scope_key" ON "api_key_blogs" USING btree ("key_id","table_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blog_asset_snapshots_path_key" ON "blog_asset_snapshots" USING btree ("revision_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "blog_receipts_request_key" ON "blog_receipts" USING btree ("workspace_id","principal_id","command","key");