-- Historical duplicate rows remain intact. New names and moves must be unique.
CREATE FUNCTION public.tabdo_name_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT lower(regexp_replace(value, '^[[:space:]]+|[[:space:]]+$', '', 'g')) $$;
--> statement-breakpoint
CREATE FUNCTION public.tabdo_check_table_name() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.organization_id = NEW.organization_id
    AND public.tabdo_name_key(OLD.name) = public.tabdo_name_key(NEW.name) THEN
    RETURN NEW;
  END IF;
  -- A real scoped row write serializes checks and makes stale repeatable-read
  -- transactions fail with 40001 rather than accepting an unseen duplicate.
  UPDATE public.organization SET name = name WHERE id = NEW.organization_id;
  IF EXISTS (SELECT 1 FROM public.tables t WHERE t.organization_id = NEW.organization_id
    AND t.id <> NEW.id AND public.tabdo_name_key(t.name) = public.tabdo_name_key(NEW.name)) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', CONSTRAINT = 'tables_org_name_unique',
      MESSAGE = '同一工作区已存在同名表格';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tables_org_name_unique
AFTER INSERT OR UPDATE OF name, organization_id ON public.tables
NOT DEFERRABLE FOR EACH ROW EXECUTE FUNCTION public.tabdo_check_table_name();
--> statement-breakpoint
CREATE FUNCTION public.tabdo_check_column_name() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.table_id = NEW.table_id
    AND public.tabdo_name_key(OLD.name) = public.tabdo_name_key(NEW.name) THEN
    RETURN NEW;
  END IF;
  UPDATE public.tables SET updated_at = updated_at WHERE id = NEW.table_id;
  IF EXISTS (SELECT 1 FROM public.columns c WHERE c.table_id = NEW.table_id
    AND c.id <> NEW.id AND public.tabdo_name_key(c.name) = public.tabdo_name_key(NEW.name)) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', CONSTRAINT = 'columns_table_name_unique',
      MESSAGE = '同一表格已存在同名字段';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER columns_table_name_unique
AFTER INSERT OR UPDATE OF name, table_id ON public.columns
NOT DEFERRABLE FOR EACH ROW EXECUTE FUNCTION public.tabdo_check_column_name();
--> statement-breakpoint
CREATE INDEX tables_org_name_lookup ON public.tables (organization_id, public.tabdo_name_key(name));
--> statement-breakpoint
CREATE INDEX columns_table_name_lookup ON public.columns (table_id, public.tabdo_name_key(name));
