CREATE TABLE "skills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "document" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "version" integer NOT NULL DEFAULT 1,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "skills_org_name_idx" ON "skills"("organization_id", "name");
--> statement-breakpoint
CREATE TABLE "skill_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "enabled" boolean NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "skill_settings_org_name_idx" ON "skill_settings"("organization_id", "name");
