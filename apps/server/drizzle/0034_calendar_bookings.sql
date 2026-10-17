CREATE TABLE "api_key_calendars" (
	"key_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"can_read" boolean DEFAULT false NOT NULL,
	"can_read_availability" boolean DEFAULT false NOT NULL,
	"can_create" boolean DEFAULT false NOT NULL,
	"can_update" boolean DEFAULT false NOT NULL,
	"can_cancel" boolean DEFAULT false NOT NULL,
	"can_manage" boolean DEFAULT false NOT NULL,
	CONSTRAINT "api_key_calendars_capability" CHECK ("api_key_calendars"."can_read" OR "api_key_calendars"."can_read_availability" OR "api_key_calendars"."can_create" OR "api_key_calendars"."can_update" OR "api_key_calendars"."can_cancel" OR "api_key_calendars"."can_manage")
);
--> statement-breakpoint
CREATE TABLE "availability_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"date" text NOT NULL,
	"intervals" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"title" text NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"time_zone" text NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"linked_row_id" uuid,
	CONSTRAINT "bookings_time_check" CHECK ("bookings"."end" > "bookings"."start"),
	CONSTRAINT "bookings_status_check" CHECK ("bookings"."status" IN ('confirmed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "calendar_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"time_zone" text NOT NULL,
	"user_id" text,
	"windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"principal_id" text NOT NULL,
	"command" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"time_zone" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_people_scope_key" ON "calendar_people" USING btree ("id","workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "calendars_scope_key" ON "calendars" USING btree ("id","workspace_id");
--> statement-breakpoint
ALTER TABLE "api_key_calendars" ADD CONSTRAINT "api_key_calendars_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_calendars" ADD CONSTRAINT "api_key_calendars_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_person_id_calendar_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."calendar_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_calendar_id_workspace_id_calendars_id_workspace_id_fk" FOREIGN KEY ("calendar_id","workspace_id") REFERENCES "public"."calendars"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_person_id_workspace_id_calendar_people_id_workspace_id_fk" FOREIGN KEY ("person_id","workspace_id") REFERENCES "public"."calendar_people"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_people" ADD CONSTRAINT "calendar_people_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_people" ADD CONSTRAINT "calendar_people_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_receipts" ADD CONSTRAINT "calendar_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_calendars_key_calendar_idx" ON "api_key_calendars" USING btree ("key_id","calendar_id");--> statement-breakpoint
CREATE INDEX "availability_exceptions_person_date_idx" ON "availability_exceptions" USING btree ("person_id","date");--> statement-breakpoint
CREATE INDEX "bookings_person_range_idx" ON "bookings" USING btree ("person_id","start","end");--> statement-breakpoint
CREATE INDEX "bookings_calendar_range_idx" ON "bookings" USING btree ("calendar_id","start","id");--> statement-breakpoint
--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_people_bound_user_key" ON "calendar_people" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "calendar_people_workspace_idx" ON "calendar_people" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_receipts_request_key" ON "calendar_receipts" USING btree ("workspace_id","principal_id","command","key");--> statement-breakpoint
--> statement-breakpoint
CREATE INDEX "calendars_workspace_idx" ON "calendars" USING btree ("workspace_id");
--> statement-breakpoint
CREATE TRIGGER calendars_workspace_guard BEFORE INSERT OR UPDATE ON public.calendars FOR EACH ROW EXECUTE FUNCTION public.tabdo_resource_workspace();
