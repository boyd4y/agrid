-- Keep every existing conversation and message visible after removing archiving.
UPDATE chat_threads SET status = 'regular' WHERE status = 'archived';
--> statement-breakpoint
ALTER TABLE chat_threads DROP CONSTRAINT chat_threads_status_check;
--> statement-breakpoint
ALTER TABLE chat_threads ADD CONSTRAINT chat_threads_status_check CHECK (status = 'regular');
