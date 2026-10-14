CREATE TABLE "storage_gc_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "storage_driver" text NOT NULL,
  "storage_key" text NOT NULL,
  "available_at" timestamptz NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "storage_gc_jobs_due_idx" ON "storage_gc_jobs" ("status", "available_at");
--> statement-breakpoint
-- Includes Better Auth organization deletion and direct metadata cascades.
CREATE FUNCTION tabdo_journal_deleted_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO storage_gc_jobs (organization_id, storage_driver, storage_key, available_at)
  VALUES (OLD.organization_id, OLD.storage_driver, OLD.storage_key, now() + interval '60 seconds');
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER file_objects_gc_delete BEFORE DELETE ON file_objects
FOR EACH ROW EXECUTE FUNCTION tabdo_journal_deleted_file();
