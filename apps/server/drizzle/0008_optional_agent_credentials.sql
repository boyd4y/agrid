-- In-app agents do not require an external API key. Preserve existing credentials.
ALTER TABLE "agent_profile" ALTER COLUMN "api_key_hash" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_profile" ALTER COLUMN "api_key_prefix" DROP NOT NULL;
