ALTER TABLE "agent_runtime_sessions" ADD COLUMN "provider" text;
--> statement-breakpoint
UPDATE "agent_runtime_sessions" SET "provider" = CASE WHEN "mode" = 'local' THEN 'local' ELSE 'vercel' END;
--> statement-breakpoint
ALTER TABLE "agent_runtime_sessions" ALTER COLUMN "provider" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_runtime_sessions" ADD COLUMN "sandbox_created" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "agent_runtime_sessions" SET "sandbox_created" = true WHERE "resume_state" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_runtime_sessions" ADD CONSTRAINT "agent_runtime_provider_mode_check" CHECK (("mode" = 'local' AND "provider" = 'local') OR ("mode" = 'sandbox' AND "provider" IN ('vercel', 'e2b', 'railway')));
