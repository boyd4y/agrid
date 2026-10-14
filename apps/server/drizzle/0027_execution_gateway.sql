CREATE TABLE agent_execution_gateways (
  execution_id uuid PRIMARY KEY REFERENCES agent_executions(id) ON DELETE CASCADE,
  launch_token uuid NOT NULL,
  token_hash text NOT NULL,
  run_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  user_id text NOT NULL,
  fence integer NOT NULL,
  lease_token uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE agent_execution_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
  tool_call_id text NOT NULL,
  name text NOT NULL,
  input jsonb NOT NULL,
  result jsonb,
  status text NOT NULL DEFAULT 'accepted',
  completed_at timestamptz,
  CONSTRAINT agent_execution_tool_calls_status_check CHECK (status IN ('accepted', 'completed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_execution_tool_calls_key_idx ON agent_execution_tool_calls(execution_id, tool_call_id);
