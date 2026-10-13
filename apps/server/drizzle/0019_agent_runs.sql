CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  runtime_session_id uuid NOT NULL REFERENCES agent_runtime_sessions(id) ON DELETE CASCADE,
  user_message_id text NOT NULL,
  assistant_message_id text NOT NULL,
  fence integer NOT NULL,
  status text NOT NULL DEFAULT 'starting' CHECK(status IN ('starting','running','completed','cancelled','failed','suspended')),
  activity jsonb,
  cancel_requested_at timestamptz,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_runs_input_idx ON agent_runs(thread_id,user_message_id);
--> statement-breakpoint
CREATE INDEX agent_runs_thread_idx ON agent_runs(thread_id,started_at,id);
--> statement-breakpoint
CREATE TABLE agent_run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  activity jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX agent_run_events_run_idx ON agent_run_events(run_id,created_at,id);
