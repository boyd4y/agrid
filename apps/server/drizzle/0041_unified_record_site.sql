ALTER TABLE "table_views" ADD COLUMN "site_id" uuid CONSTRAINT "table_views_site_id_sites_id_fk" REFERENCES "sites"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX "table_views_site_idx" ON "table_views" ("site_id");
--> statement-breakpoint
LOCK TABLE sites IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
-- Preserve all original sites, revisions, public pointers, slugs and assets.
-- Invalid/missing source references abort atomically instead of discarding content.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM sites s LEFT JOIN tables t
      ON t.id::text = s.blog_config->>'tableId'
      AND t.workspace_id = s.workspace_id AND t.organization_id = s.organization_id
    WHERE s.kind = 'blog' AND t.id IS NULL
  ) THEN RAISE EXCEPTION 'Site view migration requires valid source tables for all existing blog sites'; END IF;
END $$;
--> statement-breakpoint
INSERT INTO table_views (table_id, site_id, type, name, config, sort_order, is_default, created_at, updated_at)
SELECT t.id, s.id, 'site', s.name, (s.blog_config - 'tableId') || '{"template":"blog"}'::jsonb,
  COALESCE((SELECT max(v.sort_order) FROM table_views v WHERE v.table_id = t.id), -1)
    + row_number() OVER (PARTITION BY t.id ORDER BY s.created_at, s.id),
  false, s.created_at, s.updated_at
FROM sites s JOIN tables t ON t.id::text = s.blog_config->>'tableId'
  AND t.workspace_id = s.workspace_id AND t.organization_id = s.organization_id
WHERE s.kind = 'blog';
--> statement-breakpoint
-- Temporary rolling-cutover bridge. Old API/worker writers remain transactionally
-- mirrored until the operator drains them and runs finalize-unified-sites.
CREATE FUNCTION sync_unified_site_view() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_table tables%ROWTYPE;
BEGIN
  IF NEW.kind <> 'blog' THEN RETURN NEW; END IF;
  SELECT * INTO source_table FROM tables
    WHERE id::text = NEW.blog_config->>'tableId'
      AND organization_id = NEW.organization_id AND workspace_id = NEW.workspace_id
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Site view requires a valid scoped source table'; END IF;
  IF EXISTS (SELECT 1 FROM table_views WHERE site_id = NEW.id AND table_id <> source_table.id) THEN
    RAISE EXCEPTION 'Site view source table cannot change';
  END IF;
  INSERT INTO table_views (table_id, site_id, type, name, config, sort_order, is_default, created_at, updated_at)
    VALUES (source_table.id, NEW.id, 'site', NEW.name, (NEW.blog_config - 'tableId') || '{"template":"blog"}'::jsonb,
      COALESCE((SELECT max(sort_order) + 1 FROM table_views WHERE table_id = source_table.id), 0), false, NEW.created_at, NEW.updated_at)
    ON CONFLICT (site_id) DO UPDATE SET name = EXCLUDED.name, config = EXCLUDED.config, updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER unified_site_view_cutover AFTER INSERT OR UPDATE ON sites
  FOR EACH ROW EXECUTE FUNCTION sync_unified_site_view();
