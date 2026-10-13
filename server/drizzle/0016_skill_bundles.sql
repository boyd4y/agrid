ALTER TABLE "skills" ADD COLUMN "files" jsonb NOT NULL DEFAULT '[]'::jsonb;
