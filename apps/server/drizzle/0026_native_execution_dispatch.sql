-- Private dispatch receipts prevent provider retries from invoking a native turn twice.
CREATE TABLE agent_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  fence integer NOT NULL,
  lease_token uuid NOT NULL,
  input jsonb NOT NULL,
  status text NOT NULL DEFAULT 'accepted',
  last_cursor integer NOT NULL DEFAULT 0,
  error text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  invoked_at timestamptz,
  settled_at timestamptz,
  CONSTRAINT agent_executions_status_check CHECK (status IN ('accepted', 'invoking', 'settled')),
  CONSTRAINT agent_executions_cursor_check CHECK (last_cursor >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_executions_run_fence_idx ON agent_executions(run_id, fence);
--> statement-breakpoint
CREATE INDEX agent_executions_dispatch_idx ON agent_executions(status, accepted_at);
--> statement-breakpoint
CREATE TABLE agent_execution_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
  cursor integer NOT NULL,
  chunk jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_execution_chunks_cursor_check CHECK (cursor > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_execution_chunks_cursor_idx ON agent_execution_chunks(execution_id, cursor);
