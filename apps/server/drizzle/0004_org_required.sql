-- Scheme 2 multitenancy: shared tables + organization_id (no schema-per-tenant)
--> statement-breakpoint
-- Attach any orphan tables to the first organization (demo backfill)
UPDATE tables
SET organization_id = (
  SELECT id FROM organization ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1
)
WHERE organization_id IS NULL
  AND EXISTS (SELECT 1 FROM organization LIMIT 1);
--> statement-breakpoint
-- If still null (no orgs), delete orphans so NOT NULL can apply
DELETE FROM rows WHERE table_id IN (SELECT id FROM tables WHERE organization_id IS NULL);
--> statement-breakpoint
DELETE FROM columns WHERE table_id IN (SELECT id FROM tables WHERE organization_id IS NULL);
--> statement-breakpoint
DELETE FROM automation_runs WHERE table_id IN (SELECT id FROM tables WHERE organization_id IS NULL);
--> statement-breakpoint
DELETE FROM automations WHERE table_id IN (SELECT id FROM tables WHERE organization_id IS NULL);
--> statement-breakpoint
DELETE FROM tables WHERE organization_id IS NULL;
--> statement-breakpoint
ALTER TABLE tables ALTER COLUMN organization_id SET NOT NULL;
