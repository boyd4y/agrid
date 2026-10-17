CREATE TABLE "calendar_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"subscription_version" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"cycle_attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_until" timestamp with time zone,
	"claim_token" uuid,
	"last_error" text,
	"http_status" integer,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_deliveries_status" CHECK ("calendar_deliveries"."status" IN ('pending','delivering','succeeded','deadletter','skipped'))
);
--> statement-breakpoint
CREATE TABLE "calendar_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"status" text DEFAULT 'started' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"http_status" integer,
	"error" text,
	CONSTRAINT "calendar_delivery_attempts_status" CHECK ("calendar_delivery_attempts"."status" IN ('started','succeeded','failed','unknown','skipped'))
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_version" integer NOT NULL,
	"envelope" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_version" CHECK ("calendar_events"."aggregate_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "calendar_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"key_id" uuid,
	"name" text NOT NULL,
	"endpoint" text NOT NULL,
	"event_types" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"encrypted_secret" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_subscriptions_status" CHECK ("calendar_subscriptions"."status" IN ('active','paused','revoked')),
	CONSTRAINT "calendar_subscriptions_version" CHECK ("calendar_subscriptions"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "api_key_calendars" DROP CONSTRAINT "api_key_calendars_capability";
--> statement-breakpoint
ALTER TABLE "api_key_calendars" ADD COLUMN "can_subscribe" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_key_calendars" ADD COLUMN "can_read_deliveries" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_key_calendars" ADD COLUMN "can_manage_subscriptions" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_deliveries_event_key" ON "calendar_deliveries" USING btree ("subscription_id","event_id");
--> statement-breakpoint
CREATE INDEX "calendar_deliveries_page_idx" ON "calendar_deliveries" USING btree ("subscription_id","id");
--> statement-breakpoint
CREATE INDEX "calendar_deliveries_due_idx" ON "calendar_deliveries" USING btree ("next_attempt_at") WHERE "calendar_deliveries"."status" = 'pending';
--> statement-breakpoint
CREATE INDEX "calendar_deliveries_lease_idx" ON "calendar_deliveries" USING btree ("claim_until") WHERE "calendar_deliveries"."status" = 'delivering';
--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_delivery_attempts_number_key" ON "calendar_delivery_attempts" USING btree ("delivery_id","attempt");
--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_scope_key" ON "calendar_events" USING btree ("id","calendar_id","workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_version_key" ON "calendar_events" USING btree ("calendar_id","aggregate_id","aggregate_version","type");
--> statement-breakpoint
CREATE INDEX "calendar_events_calendar_idx" ON "calendar_events" USING btree ("calendar_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_subscriptions_scope_key" ON "calendar_subscriptions" USING btree ("id","calendar_id","workspace_id");
--> statement-breakpoint
CREATE INDEX "calendar_subscriptions_calendar_idx" ON "calendar_subscriptions" USING btree ("calendar_id");
--> statement-breakpoint
ALTER TABLE "api_key_calendars" ADD CONSTRAINT "api_key_calendars_capability" CHECK ("api_key_calendars"."can_read" OR "api_key_calendars"."can_read_availability" OR "api_key_calendars"."can_create" OR "api_key_calendars"."can_update" OR "api_key_calendars"."can_cancel" OR "api_key_calendars"."can_manage" OR "api_key_calendars"."can_trigger_agent" OR "api_key_calendars"."can_subscribe" OR "api_key_calendars"."can_read_deliveries" OR "api_key_calendars"."can_manage_subscriptions");
--> statement-breakpoint
ALTER TABLE "calendar_deliveries" ADD CONSTRAINT "calendar_deliveries_subscription_id_calendar_id_workspace_id_calendar_subscriptions_id_calendar_id_workspace_id_fk" FOREIGN KEY ("subscription_id","calendar_id","workspace_id") REFERENCES "public"."calendar_subscriptions"("id","calendar_id","workspace_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_deliveries" ADD CONSTRAINT "calendar_deliveries_event_id_calendar_id_workspace_id_calendar_events_id_calendar_id_workspace_id_fk" FOREIGN KEY ("event_id","calendar_id","workspace_id") REFERENCES "public"."calendar_events"("id","calendar_id","workspace_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_delivery_attempts" ADD CONSTRAINT "calendar_delivery_attempts_delivery_id_calendar_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."calendar_deliveries"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_calendar_id_workspace_id_calendars_id_workspace_id_fk" FOREIGN KEY ("calendar_id","workspace_id") REFERENCES "public"."calendars"("id","workspace_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_subscriptions" ADD CONSTRAINT "calendar_subscriptions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_subscriptions" ADD CONSTRAINT "calendar_subscriptions_calendar_id_workspace_id_calendars_id_workspace_id_fk" FOREIGN KEY ("calendar_id","workspace_id") REFERENCES "public"."calendars"("id","workspace_id") ON DELETE cascade ON UPDATE no action;
