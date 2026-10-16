CREATE TABLE site_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  created_by text REFERENCES "user"(id) ON DELETE SET NULL,
  name text NOT NULL,
  key_hash text NOT NULL,
  prefix text NOT NULL,
  can_read boolean NOT NULL DEFAULT false,
  can_create boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_api_keys_capability CHECK (can_read OR can_create)
);
--> statement-breakpoint
CREATE UNIQUE INDEX site_api_keys_hash_idx ON site_api_keys(key_hash);
CREATE INDEX site_api_keys_org_idx ON site_api_keys(organization_id);
--> statement-breakpoint
CREATE TABLE site_api_key_tables (
  key_id uuid NOT NULL REFERENCES site_api_keys(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES tables(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX site_api_key_tables_key_table_idx ON site_api_key_tables(key_id, table_id);
CREATE INDEX site_api_key_tables_table_idx ON site_api_key_tables(table_id);
