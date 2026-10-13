ALTER TABLE "automations" ADD COLUMN "organization_id" text;
ALTER TABLE "automations" ADD COLUMN "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL;
ALTER TABLE "automations" ADD COLUMN "source" jsonb;
ALTER TABLE "automations" ADD COLUMN "event_conditions" jsonb DEFAULT '[]'::jsonb NOT NULL;
UPDATE "automations" a SET "organization_id" = t."organization_id", "source" = jsonb_build_object('kind','table','tableId',a."table_id"::text) FROM "tables" t WHERE a."table_id"=t."id";
ALTER TABLE "automations" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "automations" ALTER COLUMN "source" SET NOT NULL;
ALTER TABLE "automations" ADD CONSTRAINT "automations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
ALTER TABLE "automations" ALTER COLUMN "table_id" DROP NOT NULL;
CREATE INDEX "automations_org_created_idx" ON "automations"("organization_id","created_at");
ALTER TABLE "automation_runs" ALTER COLUMN "table_id" DROP NOT NULL;
ALTER TABLE "automation_runs" ALTER COLUMN "row_id" DROP NOT NULL;
ALTER TABLE "automation_events" ALTER COLUMN "table_id" DROP NOT NULL;
ALTER TABLE "automation_events" ALTER COLUMN "row_id" DROP NOT NULL;
ALTER TABLE "automation_events" ALTER COLUMN "row_version" DROP NOT NULL;
ALTER TABLE "automation_events" ALTER COLUMN "expected_version" DROP NOT NULL;
--> statement-breakpoint
CREATE TABLE "integration_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "created_by_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "name" text NOT NULL,
  "encrypted_credential" jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "state" text DEFAULT 'unverified' NOT NULL,
  "last_error" text,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "integration_connections_org_idx" ON "integration_connections"("organization_id");
CREATE TABLE "webhook_endpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "created_by_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "connection_id" uuid REFERENCES "integration_connections"("id") ON DELETE CASCADE,
  "inbox_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "token_hash" text,
  "encrypted_signing_secret" jsonb,
  "remote_webhook_id" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "state" text DEFAULT 'active' NOT NULL,
  "last_error" text,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "webhook_endpoints_org_idx" ON "webhook_endpoints"("organization_id");
CREATE TABLE "integration_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "endpoint_id" uuid NOT NULL REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "logical_key" text,
  "connection_id" uuid,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'received' NOT NULL,
  "event_id" uuid,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "integration_deliveries_transport_idx" ON "integration_deliveries"("endpoint_id","dedupe_key");
CREATE UNIQUE INDEX "integration_deliveries_logical_idx" ON "integration_deliveries"("connection_id","logical_key");
CREATE TABLE "automation_schedules" (
  "automation_id" uuid PRIMARY KEY NOT NULL REFERENCES "automations"("id") ON DELETE CASCADE,
  "next_run_at" timestamp with time zone NOT NULL,
  "rule_version" integer NOT NULL
);
CREATE INDEX "automation_schedules_due_idx" ON "automation_schedules"("next_run_at");
CREATE TABLE "automation_occurrences" (
  "automation_id" uuid NOT NULL REFERENCES "automations"("id") ON DELETE CASCADE,
  "rule_version" integer NOT NULL,
  "scheduled_for" timestamp with time zone NOT NULL,
  "event_id" uuid NOT NULL
);
CREATE UNIQUE INDEX "automation_occurrences_key" ON "automation_occurrences"("automation_id","rule_version","scheduled_for");
CREATE TABLE "automation_agent_actions" (
  "run_id" uuid NOT NULL REFERENCES "automation_runs"("id") ON DELETE CASCADE,
  "step" integer NOT NULL,
  "thread_id" uuid NOT NULL,
  "user_message_id" text NOT NULL,
  "agent_run_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "automation_agent_actions_key" ON "automation_agent_actions"("run_id","step");
