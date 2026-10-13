CREATE TABLE IF NOT EXISTS agent_runtime_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  agent_profile_id uuid NOT NULL REFERENCES agent_profile(id) ON DELETE CASCADE,
  harness text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('local','sandbox')),
  session_id uuid NOT NULL DEFAULT gen_random_uuid(),
  sandbox_id text NOT NULL,
  resume_state jsonb,
  workspace jsonb,
  last_user_message_id text,
  last_assistant_message_id text,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','interrupted','failed')),
  error text,
  plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  goal jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS agent_runtime_thread_profile_idx ON agent_runtime_sessions(thread_id,agent_profile_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_thread_leases (
  thread_id uuid PRIMARY KEY REFERENCES chat_threads(id) ON DELETE CASCADE,
  token uuid,
  fence integer NOT NULL DEFAULT 0,
  expires_at timestamptz
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_workspace_settings (
  organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  instructions text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
