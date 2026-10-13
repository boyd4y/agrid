CREATE TABLE table_relations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 source_table_id uuid NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
 target_table_id uuid NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
 source_column_id uuid NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
 inverse_column_id uuid REFERENCES columns(id) ON DELETE CASCADE,
 source_single boolean NOT NULL DEFAULT false, target_single boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE INDEX relation_source_table_idx ON table_relations(source_table_id);
CREATE INDEX relation_target_table_idx ON table_relations(target_table_id);
CREATE TABLE row_relations (
 relation_id uuid NOT NULL REFERENCES table_relations(id) ON DELETE CASCADE,
 source_row_id uuid NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
 target_row_id uuid NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
 source_single boolean NOT NULL, target_single boolean NOT NULL
);
CREATE UNIQUE INDEX relation_edge_unique ON row_relations(relation_id,source_row_id,target_row_id);
CREATE INDEX relation_target_row_idx ON row_relations(relation_id,target_row_id,source_row_id);
CREATE UNIQUE INDEX relation_source_single ON row_relations(relation_id,source_row_id) WHERE source_single;
CREATE UNIQUE INDEX relation_target_single ON row_relations(relation_id,target_row_id) WHERE target_single;
--> statement-breakpoint
CREATE FUNCTION validate_relation_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM tables s JOIN tables t ON t.id=NEW.target_table_id
 JOIN columns c ON c.id=NEW.source_column_id
 WHERE s.id=NEW.source_table_id AND s.organization_id=NEW.organization_id
 AND t.organization_id=NEW.organization_id AND c.table_id=s.id AND c.type='relation')
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
CREATE TRIGGER relation_definition_guard BEFORE INSERT OR UPDATE ON table_relations FOR EACH ROW EXECUTE FUNCTION validate_relation_definition();
--> statement-breakpoint
CREATE FUNCTION validate_relation_edge() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE definition table_relations%ROWTYPE;
BEGIN
 SELECT * INTO definition FROM table_relations WHERE id=NEW.relation_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM rows WHERE id=NEW.source_row_id AND table_id=definition.source_table_id)
 OR NOT EXISTS (SELECT 1 FROM rows WHERE id=NEW.target_row_id AND table_id=definition.target_table_id) THEN
 RAISE EXCEPTION '关联记录不属于指定的表格';
 END IF;
 NEW.source_single=definition.source_single; NEW.target_single=definition.target_single;
 RETURN NEW;
END $$;
CREATE TRIGGER relation_edge_guard BEFORE INSERT OR UPDATE ON row_relations FOR EACH ROW EXECUTE FUNCTION validate_relation_edge();
