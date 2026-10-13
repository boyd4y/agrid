import { useContext, useEffect, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { Check, Circle, ListChecks, LoaderCircle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentTaskState } from "@tabdo/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { FieldDescription, FieldError } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatActivityContext } from "./ChatRunStatus";

export function AgentTaskPopover() {
  const { t } = useTranslation("chat");
  const remoteId = useAuiState((state) => state.threadListItem.remoteId);
  const running = useAuiState((state) => state.thread.isRunning);
  const activity = useContext(ChatActivityContext).get(remoteId ?? "");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AgentTaskState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const goalLabels = {
    active: t("task.goalActive"),
    paused: t("task.goalPaused"),
    complete: t("task.goalComplete"),
    cancelled: t("task.goalCancelled"),
  } as const;
  useEffect(() => {
    setState(null); setError(null); setLoading(false);
  }, [remoteId]);
  useEffect(() => {
    if (!open || !remoteId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      setLoading(true);
      try {
        const result = await api.getAgentTaskState(remoteId, controller.signal);
        if (!controller.signal.aborted) { setState(result.state); setError(null); }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("task.loadFailed"));
      } finally {
        if (!controller.signal.aborted) { setLoading(false); if (running) timer = setTimeout(() => void load(), 2000); }
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, remoteId, running, activity?.phase, revision, t]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("task.viewAria")} title={t("task.title")} data-testid="agent-task-toggle">
          <ListChecks />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96" aria-label={t("task.title")} data-testid="agent-task-state">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">{t("task.title")}</h2>
          <Button size="icon" variant="ghost" onClick={() => setRevision((value) => value + 1)} disabled={loading || !remoteId} aria-label={t("task.refreshAria")}><RefreshCw /></Button>
        </div>
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-auto py-2">
          {error ? <FieldError>{error}</FieldError> : loading && !state ? <Skeleton className="h-24 w-full" /> : null}
          {state?.goal && <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2"><p className="break-words font-medium">{state.goal.objective}</p><Badge variant="secondary">{goalLabels[state.goal.status]}</Badge></div>
            {state.goal.progress && <FieldDescription className="whitespace-pre-wrap break-words">{state.goal.progress}</FieldDescription>}
          </div>}
          {Boolean(state?.plan.length) && <>
            {state?.goal && <Separator />}
            <ol className="flex flex-col gap-3">
              {state!.plan.map((step, index) => {
                const Icon = step.status === "completed" ? Check : step.status === "in_progress" ? LoaderCircle : Circle;
                const stepAria = step.status === "completed" ? t("task.stepCompleted") : step.status === "in_progress" ? t("task.stepInProgress") : t("task.stepPending");
                return <li key={index} className="flex items-start gap-2"><Icon className="mt-0.5 size-4 shrink-0" aria-label={stepAria} /><span className="break-words text-sm">{step.text}</span></li>;
              })}
            </ol>
          </>}
          {!loading && !error && !state?.goal && !state?.plan.length && <FieldDescription>{t("task.empty")}</FieldDescription>}
          {state && <FieldDescription>{t("task.persistHint")}</FieldDescription>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
