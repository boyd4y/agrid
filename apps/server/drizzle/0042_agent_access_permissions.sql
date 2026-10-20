CREATE TABLE "api_key_automations" (
	"key_id" uuid NOT NULL,
	"automation_id" uuid NOT NULL,
	"can_read" boolean DEFAULT false NOT NULL,
	"can_update" boolean DEFAULT false NOT NULL,
	"can_delete" boolean DEFAULT false NOT NULL,
	CONSTRAINT "api_key_automations_capability" CHECK ("api_key_automations"."can_read" OR "api_key_automations"."can_update" OR "api_key_automations"."can_delete")
);
--> statement-breakpoint
CREATE TABLE "api_key_workspaces" (
	"key_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"can_create_automations" boolean DEFAULT false NOT NULL,
	"can_create_schedules" boolean DEFAULT false NOT NULL,
	CONSTRAINT "api_key_workspaces_capability" CHECK ("api_key_workspaces"."can_create_automations" OR "api_key_workspaces"."can_create_schedules")
);
--> statement-breakpoint
ALTER TABLE "api_key_schedules" DROP CONSTRAINT "api_key_schedules_capability";--> statement-breakpoint
ALTER TABLE "api_key_schedules" ADD COLUMN "grant_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_schedules" ADD COLUMN "can_delete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "execution_key_id" uuid;--> statement-breakpoint
ALTER TABLE "api_key_automations" ADD CONSTRAINT "api_key_automations_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_automations" ADD CONSTRAINT "api_key_automations_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_workspaces" ADD CONSTRAINT "api_key_workspaces_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_workspaces" ADD CONSTRAINT "api_key_workspaces_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_automations_key_rule_idx" ON "api_key_automations" USING btree ("key_id","automation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_workspaces_key_workspace_idx" ON "api_key_workspaces" USING btree ("key_id","workspace_id");--> statement-breakpoint
ALTER TABLE "api_key_schedules" ADD CONSTRAINT "api_key_schedules_grant_version" CHECK ("api_key_schedules"."grant_version" IN (1, 2));--> statement-breakpoint
ALTER TABLE "api_key_schedules" ADD CONSTRAINT "api_key_schedules_capability" CHECK ("api_key_schedules"."can_read" OR "api_key_schedules"."can_update" OR "api_key_schedules"."can_delete");