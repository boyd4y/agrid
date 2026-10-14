ALTER TABLE public.chat_threads ADD COLUMN kind text NOT NULL DEFAULT 'chat';
--> statement-breakpoint
ALTER TABLE public.chat_threads ADD COLUMN scheduled_task_id uuid REFERENCES public.automations(id) ON DELETE CASCADE;
--> statement-breakpoint
UPDATE public.chat_threads t SET kind='scheduled_task', scheduled_task_id=a.id,
 custom=t.custom || jsonb_build_object('resourceKey','schedule:' || a.id::text)
FROM public.automation_agent_actions m JOIN public.automation_runs r ON r.id=m.run_id
JOIN public.automations a ON a.id=r.automation_id
WHERE t.id=m.thread_id AND a.source->>'kind'='schedule';
--> statement-breakpoint
ALTER TABLE public.chat_threads ADD CONSTRAINT chat_threads_kind_check CHECK (
 (kind='chat' AND scheduled_task_id IS NULL) OR (kind='scheduled_task' AND scheduled_task_id IS NOT NULL));
--> statement-breakpoint
CREATE INDEX chat_threads_kind_owner_idx ON public.chat_threads(user_id,organization_id,kind,created_at,id);
--> statement-breakpoint
CREATE INDEX chat_threads_scheduled_task_idx ON public.chat_threads(scheduled_task_id,user_id,created_at,id);
