-- Flush deferred publication FK checks before ALTER/backfill in the migration transaction.
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "chat_threads_client_idx";--> statement-breakpoint
DROP INDEX "chat_threads_owner_idx";--> statement-breakpoint
DROP INDEX "chat_threads_kind_owner_idx";--> statement-breakpoint
DROP INDEX "tables_org_name_lookup";--> statement-breakpoint
ALTER TABLE "automation_events" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN "workspace_id" uuid DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "workspace_id" uuid DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD COLUMN "workspace_id" uuid DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "file_objects" ADD COLUMN "workspace_id" uuid DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "workspace_id" uuid DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "workspace_id" uuid DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "workspace_id" uuid DEFAULT NULL;--> statement-breakpoint
-- All statements run in the migration runner transaction. Existing IDs and JSON stay unchanged.
INSERT INTO workspaces (organization_id, name, is_default) SELECT id, name, true FROM organization;
--> statement-breakpoint
UPDATE tables r SET workspace_id = w.id FROM workspaces w WHERE w.organization_id = r.organization_id AND w.is_default;
--> statement-breakpoint
UPDATE automations r SET workspace_id = w.id FROM workspaces w WHERE w.organization_id = r.organization_id AND w.is_default;
--> statement-breakpoint
UPDATE reports r SET workspace_id = w.id FROM workspaces w WHERE w.organization_id = r.organization_id AND w.is_default;
--> statement-breakpoint
UPDATE sites r SET workspace_id = w.id FROM workspaces w WHERE w.organization_id = r.organization_id AND w.is_default;
--> statement-breakpoint
UPDATE chat_threads r SET workspace_id = w.id FROM workspaces w WHERE w.organization_id = r.organization_id AND w.is_default;
--> statement-breakpoint
UPDATE file_objects r SET workspace_id = w.id FROM workspaces w WHERE w.organization_id = r.organization_id AND w.is_default;
--> statement-breakpoint
UPDATE automation_events e SET workspace_id = t.workspace_id FROM tables t WHERE e.table_id = t.id;
--> statement-breakpoint
UPDATE automation_events e SET workspace_id = w.id FROM workspaces w WHERE e.table_id IS NOT NULL AND e.workspace_id IS NULL AND w.organization_id = e.organization_id AND w.is_default;
--> statement-breakpoint
UPDATE automation_runs r SET workspace_id = COALESCE(
  (SELECT a.workspace_id FROM automations a WHERE a.id=r.automation_id),
  (SELECT t.workspace_id FROM tables t WHERE t.id=r.table_id),
  (SELECT w.id FROM workspaces w WHERE w.is_default AND w.organization_id=COALESCE(r.rule_snapshot->>'organizationId', (SELECT e.organization_id FROM automation_events e WHERE e.id=r.event_id)))
);
--> statement-breakpoint
UPDATE automation_runs SET rule_snapshot = rule_snapshot || jsonb_build_object('workspaceId',workspace_id) WHERE rule_snapshot IS NOT NULL;
--> statement-breakpoint
ALTER TABLE tables ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE automations ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE reports ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE sites ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE chat_threads ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE file_objects ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE automation_runs ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspaces_org_idx" ON "workspaces" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_default_idx" ON "workspaces" USING btree ("organization_id") WHERE "workspaces"."is_default" = true;--> statement-breakpoint
ALTER TABLE "automation_events" ADD CONSTRAINT "automation_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automations_workspace_created_idx" ON "automations" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "reports_workspace_created_idx" ON "reports" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "sites_workspace_updated_idx" ON "sites" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "tables_workspace_idx" ON "tables" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_threads_client_idx" ON "chat_threads" USING btree ("user_id","workspace_id","client_id");--> statement-breakpoint
CREATE INDEX "chat_threads_owner_idx" ON "chat_threads" USING btree ("user_id","workspace_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "chat_threads_kind_owner_idx" ON "chat_threads" USING btree ("user_id","workspace_id","kind","created_at","id");--> statement-breakpoint
CREATE INDEX "tables_org_name_lookup" ON "tables" USING btree ("workspace_id",public.tabdo_name_key("name"));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.tabdo_check_table_name() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.workspace_id = NEW.workspace_id AND public.tabdo_name_key(OLD.name) = public.tabdo_name_key(NEW.name) THEN RETURN NEW; END IF;
  UPDATE public.workspaces SET name = name WHERE id = NEW.workspace_id;
  IF EXISTS (SELECT 1 FROM public.tables t WHERE t.workspace_id = NEW.workspace_id AND t.id <> NEW.id AND public.tabdo_name_key(t.name) = public.tabdo_name_key(NEW.name)) THEN
    RAISE EXCEPTION USING ERRCODE='23505', CONSTRAINT='tables_org_name_unique', MESSAGE='同一工作区已存在同名表格';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.tabdo_default_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.workspaces (organization_id,name,is_default) VALUES (NEW.id,NEW.name,true);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER organization_default_workspace AFTER INSERT ON public.organization FOR EACH ROW EXECUTE FUNCTION public.tabdo_default_workspace();
--> statement-breakpoint
CREATE FUNCTION public.tabdo_resource_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id) THEN
    RAISE EXCEPTION 'Resource workspace cannot change';
  END IF;
  IF NEW.workspace_id IS NULL THEN
    SELECT id INTO NEW.workspace_id FROM public.workspaces WHERE organization_id=NEW.organization_id AND is_default;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id=NEW.workspace_id AND organization_id=NEW.organization_id) THEN
    RAISE EXCEPTION 'Workspace does not belong to organization';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tables_workspace_guard BEFORE INSERT OR UPDATE ON public.tables FOR EACH ROW EXECUTE FUNCTION public.tabdo_resource_workspace();
--> statement-breakpoint
CREATE TRIGGER automations_workspace_guard BEFORE INSERT OR UPDATE ON public.automations FOR EACH ROW EXECUTE FUNCTION public.tabdo_resource_workspace();
--> statement-breakpoint
CREATE TRIGGER reports_workspace_guard BEFORE INSERT OR UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION public.tabdo_resource_workspace();
--> statement-breakpoint
CREATE TRIGGER sites_workspace_guard BEFORE INSERT OR UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.tabdo_resource_workspace();
--> statement-breakpoint
CREATE TRIGGER chat_threads_workspace_guard BEFORE INSERT OR UPDATE ON public.chat_threads FOR EACH ROW EXECUTE FUNCTION public.tabdo_resource_workspace();
--> statement-breakpoint
CREATE TRIGGER file_objects_workspace_guard BEFORE INSERT OR UPDATE ON public.file_objects FOR EACH ROW EXECUTE FUNCTION public.tabdo_resource_workspace();
--> statement-breakpoint
CREATE FUNCTION public.tabdo_run_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected uuid;
BEGIN
 SELECT COALESCE((SELECT workspace_id FROM public.automations WHERE id=NEW.automation_id), (SELECT workspace_id FROM public.tables WHERE id=NEW.table_id), (SELECT workspace_id FROM public.automation_events WHERE id=NEW.event_id)) INTO expected;
 IF NEW.workspace_id IS NULL THEN NEW.workspace_id := expected; END IF;
 IF NEW.workspace_id IS NULL OR (expected IS NOT NULL AND NEW.workspace_id<>expected)
   OR (TG_OP='UPDATE' AND NEW.workspace_id IS DISTINCT FROM OLD.workspace_id) THEN RAISE EXCEPTION 'Invalid automation run workspace'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER automation_runs_workspace_guard BEFORE INSERT OR UPDATE ON public.automation_runs FOR EACH ROW EXECUTE FUNCTION public.tabdo_run_workspace();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_relation_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM tables s JOIN tables t ON t.id=NEW.target_table_id
 JOIN columns c ON c.id=NEW.source_column_id
 WHERE s.id=NEW.source_table_id AND s.organization_id=NEW.organization_id
 AND t.organization_id=NEW.organization_id AND t.workspace_id=s.workspace_id AND c.table_id=s.id AND c.type='relation')
 OR (NEW.inverse_column_id IS NOT NULL AND NOT EXISTS
 (SELECT 1 FROM columns WHERE id=NEW.inverse_column_id AND table_id=NEW.target_table_id AND type='relation')) THEN
 RAISE EXCEPTION '关联定义的表格、字段或工作区不一致';
 END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.source_table_id,NEW.target_table_id,NEW.source_column_id,NEW.inverse_column_id,NEW.source_single,NEW.target_single)
 IS DISTINCT FROM ROW(OLD.source_table_id,OLD.target_table_id,OLD.source_column_id,OLD.inverse_column_id,OLD.source_single,OLD.target_single) THEN
 RAISE EXCEPTION '关联结构不可直接修改，请创建新的关联字段';
 END IF;
 RETURN NEW;
END $$;
