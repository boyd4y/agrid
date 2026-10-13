CREATE TABLE "reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "table_id" uuid NOT NULL REFERENCES "tables"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "config" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "reports_org_created_idx" ON "reports" ("organization_id", "created_at");
