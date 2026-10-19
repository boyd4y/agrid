CREATE TABLE "agent_memory_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_profile_id" uuid NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_memory_topics" (
	"scope_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"type" text NOT NULL,
	"body" text NOT NULL,
	CONSTRAINT "agent_memory_type_check" CHECK ("agent_memory_topics"."type" in ('user', 'feedback', 'project', 'reference'))
);
--> statement-breakpoint
ALTER TABLE "agent_memory_scopes" ADD CONSTRAINT "agent_memory_scopes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_scopes" ADD CONSTRAINT "agent_memory_scopes_agent_profile_id_agent_profile_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_scopes" ADD CONSTRAINT "agent_memory_scopes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_scopes" ADD CONSTRAINT "agent_memory_scopes_workspace_id_organization_id_workspaces_id_organization_id_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."workspaces"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_topics" ADD CONSTRAINT "agent_memory_topics_scope_id_agent_memory_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."agent_memory_scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_memory_scope_key" ON "agent_memory_scopes" USING btree ("organization_id","workspace_id","agent_profile_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_memory_topic_key" ON "agent_memory_topics" USING btree ("scope_id","topic");