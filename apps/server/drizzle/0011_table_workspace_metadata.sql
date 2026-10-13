ALTER TABLE "tables" ADD COLUMN "icon" text;
--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;
