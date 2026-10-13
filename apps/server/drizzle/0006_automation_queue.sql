ALTER TABLE automations ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE automations ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE automation_runs DROP CONSTRAINT IF EXISTS automation_runs_automation_id_automations_id_fk;
ALTER TABLE automation_runs DROP CONSTRAINT IF EXISTS automation_runs_table_id_tables_id_fk;
ALTER TABLE automation_runs DROP CONSTRAINT IF EXISTS automation_runs_row_id_rows_id_fk;
ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS event_id uuid;
ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS rule_version integer NOT NULL DEFAULT 1;
ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS rule_snapshot jsonb;
ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS next_step integer NOT NULL DEFAULT 0;
ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS automation_runs_event_rule_idx ON automation_runs(event_id, automation_id, rule_version);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS automation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL,
 table_id uuid NOT NULL, row_id uuid NOT NULL, row_version integer NOT NULL,
 expected_version integer NOT NULL, snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending', fence integer NOT NULL DEFAULT 0,
 error text, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS automation_events_org_status_idx ON automation_events(organization_id,status);
CREATE INDEX IF NOT EXISTS automation_events_row_idx ON automation_events(row_id,row_version);
CREATE TABLE IF NOT EXISTS automation_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES automation_events(id) ON DELETE CASCADE,
 queue text NOT NULL, status text NOT NULL DEFAULT 'pending', generation integer NOT NULL DEFAULT 0,
 published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS automation_outbox_event_queue_idx ON automation_outbox(event_id,queue);
CREATE INDEX IF NOT EXISTS automation_outbox_delivery_idx ON automation_outbox(status,published_at);
CREATE TABLE IF NOT EXISTS automation_step_receipts (
 run_id uuid NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE, step integer NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS automation_step_receipts_key ON automation_step_receipts(run_id,step);
CREATE TABLE IF NOT EXISTS automation_backlog (
 organization_id text PRIMARY KEY, pending_count integer NOT NULL DEFAULT 0, pending_bytes bigint NOT NULL DEFAULT 0
);
