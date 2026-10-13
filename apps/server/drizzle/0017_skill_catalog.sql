INSERT INTO "skill_settings" ("organization_id", "name", "enabled")
SELECT "organization_id", CASE
  WHEN "name" IN ('table-operations', 'table-relations', 'automation-design') THEN 'table'
  WHEN "name" = 'form-design' THEN 'form'
  ELSE 'report' END, bool_and("enabled")
FROM "skill_settings"
WHERE "name" IN ('table-operations', 'table-relations', 'automation-design', 'form-design', 'report-design')
GROUP BY "organization_id", CASE
  WHEN "name" IN ('table-operations', 'table-relations', 'automation-design') THEN 'table'
  WHEN "name" = 'form-design' THEN 'form'
  ELSE 'report' END
ON CONFLICT ("organization_id", "name") DO NOTHING;
--> statement-breakpoint
DELETE FROM "skill_settings" WHERE "name" IN ('table-operations', 'table-relations', 'automation-design', 'form-design', 'report-design');
--> statement-breakpoint
UPDATE "agent_profile" AS p
SET "persona" = jsonb_set(p."persona", '{skillNames}', (
  SELECT coalesce(jsonb_agg(DISTINCT CASE
    WHEN value IN ('table-operations', 'table-relations', 'automation-design') THEN 'table'
    WHEN value = 'form-design' THEN 'form'
    WHEN value = 'report-design' THEN 'report'
    ELSE value END), '[]'::jsonb)
  FROM jsonb_array_elements_text(p."persona"->'skillNames')
))
WHERE jsonb_typeof(p."persona"->'skillNames') = 'array';
