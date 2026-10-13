CREATE TABLE chat_threads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE, client_id text NOT NULL,
 title text, status text NOT NULL DEFAULT 'regular', custom jsonb NOT NULL DEFAULT '{}', head_id text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), last_message_at timestamptz,
 CONSTRAINT chat_threads_status_check CHECK (status IN ('regular', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_threads_client_idx ON chat_threads(user_id, organization_id, client_id);
--> statement-breakpoint
CREATE INDEX chat_threads_owner_idx ON chat_threads(user_id, organization_id, updated_at, id);
--> statement-breakpoint
CREATE TABLE chat_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
 message_id text NOT NULL, parent_id text, format text NOT NULL DEFAULT 'ai-sdk/v6', content jsonb NOT NULL,
 server_final boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_thread_message_idx ON chat_messages(thread_id, message_id);
--> statement-breakpoint
CREATE INDEX chat_messages_thread_idx ON chat_messages(thread_id, created_at, id);
