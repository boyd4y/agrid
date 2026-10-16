ALTER TABLE user_api_keys RENAME TO api_keys;
ALTER TABLE api_keys ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE api_keys DROP CONSTRAINT user_api_keys_user_id_fkey;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_creator_fk FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE api_key_tables (
  key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  can_read boolean NOT NULL DEFAULT false,
  can_create boolean NOT NULL DEFAULT false,
  can_update boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  CONSTRAINT api_key_tables_capability CHECK (can_read OR can_create OR can_update OR can_delete)
);
CREATE UNIQUE INDEX api_key_tables_key_table_idx ON api_key_tables(key_id, table_id);
CREATE INDEX api_key_tables_table_idx ON api_key_tables(table_id);
--> statement-breakpoint
-- Existing personal keys keep CRUD access to the workspace's current tables.
INSERT INTO api_key_tables (key_id, table_id, can_read, can_create, can_update, can_delete)
SELECT k.id, t.id, true, true, true, true FROM api_keys k JOIN tables t ON t.organization_id=k.organization_id WHERE k.revoked_at IS NULL;
--> statement-breakpoint
-- Preserve existing credentials verbatim, including hashes, ids and prefixes.
INSERT INTO api_keys (id, user_id, organization_id, name, key_hash, prefix, created_at)
SELECT id, created_by, organization_id, name, key_hash, prefix, created_at FROM site_api_keys;
INSERT INTO api_key_tables (key_id, table_id, can_read, can_create, can_update, can_delete)
SELECT g.key_id, g.table_id, k.can_read, k.can_create, false, false FROM site_api_key_tables g JOIN site_api_keys k ON k.id=g.key_id;
--> statement-breakpoint
DROP TABLE site_api_key_tables;
DROP TABLE site_api_keys;
