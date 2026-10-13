CREATE TABLE "file_objects" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "table_id" uuid NOT NULL REFERENCES "tables"("id") ON DELETE CASCADE,
  "column_id" uuid NOT NULL REFERENCES "columns"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "size" integer NOT NULL CHECK ("size" >= 0),
  "mime_type" text NOT NULL,
  "storage_driver" text NOT NULL CHECK ("storage_driver" IN ('local', 's3')),
  "storage_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "file_objects_org_idx" ON "file_objects" ("organization_id");
--> statement-breakpoint
CREATE INDEX "file_objects_column_idx" ON "file_objects" ("column_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "file_objects_storage_idx" ON "file_objects" ("storage_driver", "storage_key");
