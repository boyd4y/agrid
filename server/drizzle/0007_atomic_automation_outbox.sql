-- Business changes, matched plans and delivery records share one PG transaction.
ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 0;
ALTER TABLE automation_events ALTER COLUMN status SET DEFAULT 'matched';
DROP TABLE IF EXISTS automation_backlog;
CREATE TABLE IF NOT EXISTS automation_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES automation_events(id) ON DELETE CASCADE,
 queue text NOT NULL, status text NOT NULL DEFAULT 'pending', generation integer NOT NULL DEFAULT 0,
 published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE automation_outbox ADD COLUMN IF NOT EXISTS payload jsonb;
ALTER TABLE automation_outbox ADD COLUMN IF NOT EXISTS claim_token uuid;
ALTER TABLE automation_outbox ADD COLUMN IF NOT EXISTS claim_until timestamptz;
ALTER TABLE automation_outbox ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE automation_outbox ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE automation_outbox ADD COLUMN IF NOT EXISTS last_error text;
UPDATE automation_outbox SET payload = jsonb_build_object('protocol', 1, 'eventId', event_id, 'generation', generation)
 WHERE payload IS NULL;
ALTER TABLE automation_outbox ALTER COLUMN payload SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS automation_outbox_event_queue_idx ON automation_outbox(event_id, queue);
DROP INDEX IF EXISTS automation_outbox_pending_idx;
DROP INDEX IF EXISTS automation_outbox_claim_idx;
DROP INDEX IF EXISTS automation_outbox_delivery_idx;
CREATE INDEX automation_outbox_pending_idx ON automation_outbox(available_at, id) WHERE status = 'pending';
CREATE INDEX automation_outbox_claim_idx ON automation_outbox(claim_until, id) WHERE status = 'publishing';
