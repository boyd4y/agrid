CREATE TABLE "api_key_schedules" (
	"key_id" uuid NOT NULL,
	"automation_id" uuid NOT NULL,
	"can_read" boolean DEFAULT false NOT NULL,
	"can_update" boolean DEFAULT false NOT NULL,
	CONSTRAINT "api_key_schedules_capability" CHECK ("api_key_schedules"."can_read" OR "api_key_schedules"."can_update")
);
--> statement-breakpoint
CREATE TABLE "booking_reminder_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"reminder_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"offset_minutes" integer NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"event_id" uuid,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "booking_reminder_intents_revision" CHECK ("booking_reminder_intents"."revision" > 0),
	CONSTRAINT "booking_reminder_intents_kind" CHECK (("booking_reminder_intents"."kind" = 'before_start' AND "booking_reminder_intents"."offset_minutes" > 0 AND "booking_reminder_intents"."offset_minutes" <= 43200) OR ("booking_reminder_intents"."kind" = 'at_end' AND "booking_reminder_intents"."offset_minutes" = 0)),
	CONSTRAINT "booking_reminder_intents_status" CHECK ("booking_reminder_intents"."status" IN ('pending','queued','accepted','skipped','superseded','failed'))
);
--> statement-breakpoint
CREATE TABLE "booking_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"key_id" uuid,
	"configuration" jsonb NOT NULL,
	"automation_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_key_calendars" DROP CONSTRAINT "api_key_calendars_capability";--> statement-breakpoint
ALTER TABLE "api_key_calendars" ADD COLUMN "can_trigger_agent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_scope_key" ON "bookings" USING btree ("id","workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "booking_reminders_scope_key" ON "booking_reminders" USING btree ("id","booking_id","workspace_id");
--> statement-breakpoint
ALTER TABLE "api_key_schedules" ADD CONSTRAINT "api_key_schedules_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_schedules" ADD CONSTRAINT "api_key_schedules_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reminder_intents" ADD CONSTRAINT "booking_reminder_intents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reminder_intents" ADD CONSTRAINT "booking_reminder_intents_event_id_automation_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."automation_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reminder_intents" ADD CONSTRAINT "booking_reminder_intents_booking_id_workspace_id_bookings_id_workspace_id_fk" FOREIGN KEY ("booking_id","workspace_id") REFERENCES "public"."bookings"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reminder_intents" ADD CONSTRAINT "booking_reminder_intents_reminder_id_booking_id_workspace_id_booking_reminders_id_booking_id_workspace_id_fk" FOREIGN KEY ("reminder_id","booking_id","workspace_id") REFERENCES "public"."booking_reminders"("id","booking_id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reminders" ADD CONSTRAINT "booking_reminders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reminders" ADD CONSTRAINT "booking_reminders_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reminders" ADD CONSTRAINT "booking_reminders_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reminders" ADD CONSTRAINT "booking_reminders_booking_id_workspace_id_bookings_id_workspace_id_fk" FOREIGN KEY ("booking_id","workspace_id") REFERENCES "public"."bookings"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_schedules_key_rule_idx" ON "api_key_schedules" USING btree ("key_id","automation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_reminder_intents_key" ON "booking_reminder_intents" USING btree ("booking_id","revision","kind","offset_minutes");--> statement-breakpoint
CREATE INDEX "booking_reminder_intents_due_idx" ON "booking_reminder_intents" USING btree ("scheduled_for") WHERE "booking_reminder_intents"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "booking_reminder_intents_booking_idx" ON "booking_reminder_intents" USING btree ("booking_id","revision");--> statement-breakpoint
CREATE INDEX "booking_reminders_booking_idx" ON "booking_reminders" USING btree ("booking_id");--> statement-breakpoint
ALTER TABLE "api_key_calendars" ADD CONSTRAINT "api_key_calendars_capability" CHECK ("api_key_calendars"."can_read" OR "api_key_calendars"."can_read_availability" OR "api_key_calendars"."can_create" OR "api_key_calendars"."can_update" OR "api_key_calendars"."can_cancel" OR "api_key_calendars"."can_manage" OR "api_key_calendars"."can_trigger_agent");