import { useCallback, useEffect, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { ArrowLeft, MessageSquare, Pencil, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AutomationRule, ScheduledTaskRun } from "@tabdo/shared";
import { api } from "@/lib/api";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useRemotePagination, type ListPageRequest } from "@/hooks/useListPagination";
import { Button } from "@tabdo/ui/components/button";
import { Badge } from "@tabdo/ui/components/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@tabdo/ui/components/card";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { DataRefreshButton } from "@/components/controls/data-refresh-button";
import { ListItemLink } from "@/components/controls/list-item-link";
import { ListPagination } from "@/components/controls/list-pagination";
import type { AppOutletContext } from "@/layouts/AppShell";
import { scheduleLabel } from "./SchedulesPage";

export function ScheduledTasksEmpty() {
  const { t } = useTranslation("automation");
  return <AppEmptyState className="flex-1" illustration={NOTIOLY.chill} title={t("scheduled.noTasks")} description={t("scheduled.description")} action={<Button asChild><Link to="/app/schedules/new"><Plus data-icon="inline-start" />{t("scheduled.new")}</Link></Button>} />;
}
function displayStatus(run: ScheduledTaskRun) {
  if (["starting", "running"].includes(run.nativeStatus ?? "")) return "running";
  if (run.nativeStatus === "suspended") return run.status === "waiting_input" ? "waiting_input" : "unknown";
  return run.nativeStatus ?? run.status;
}
export function ScheduledTaskRunsPage() {
  const { t } = useTranslation("automation"), { automationId = "" } = useParams();
  const [task, setTask] = useState<AutomationRule | null>(null), [error, setError] = useState<string | null>(null);
  const load = useCallback(async ({ offset, limit, signal }: ListPageRequest) => {
    const result = await api.listScheduledRuns(automationId, offset, limit, signal);
    return { items: result.runs, hasMore: result.hasMore };
  }, [automationId]);
  const list = useRemotePagination(load, t("loadFailed"));
  useEffect(() => { let cancelled = false; setTask(null); setError(null); void api.getAutomation(automationId).then(task => { if (!cancelled) setTask(task); }).catch(error => { if (!cancelled) setError(error.message); }); return () => { cancelled = true; }; }, [automationId]);
  useEffect(() => { const timer = window.setInterval(() => { if (!document.hidden) void list.refresh(); }, 5000); return () => window.clearInterval(timer); }, [list.refresh]);
  return <section className="flex min-h-0 flex-1 flex-col" data-testid="scheduled-runs">
    <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-5"><div className="min-w-0"><h2 className="truncate text-lg font-semibold">{task?.name ?? t("runs")}</h2>{task && <p className="mt-1 text-xs text-muted-foreground">{scheduleLabel(task, t)}</p>}</div><div className="flex items-center gap-2"><DataRefreshButton disabled={list.loading} onRefresh={list.refresh} /><Button asChild variant="outline" size="sm"><Link to={`/app/schedules/${automationId}/edit`}><Pencil data-icon="inline-start" />{t("scheduled.edit")}</Link></Button></div></header>
    <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-8">
      {error || list.error ? <ListErrorState description={error ?? list.error} onRetry={list.refresh} /> : null}
      {!list.items.length ? list.loading ? <p role="status">{t("loading")}</p> : !list.error && <AppEmptyState illustration={NOTIOLY.chill} title={t("noRunRecords")} description={t("scheduled.runsEmptyDescription")} /> : <>
        <ul className="mx-auto flex max-w-4xl flex-col gap-4">{list.items.map(run => {
          const status = displayStatus(run);
          return <li key={run.id}><Card padding="lg" className="relative min-w-0 transition-colors hover:bg-accent/40" data-testid="scheduled-run-card" data-run-id={run.id}>
            {run.threadId && <ListItemLink to={`/app/schedules/${automationId}/runs/${run.threadId}`} label={t("scheduled.openRunNamed", { date: new Date(run.createdAt).toLocaleString() })} />}
            <CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>{t("scheduled.runAt", { date: new Date(run.createdAt).toLocaleString() })}</CardTitle><Badge variant={status === "completed" ? "success" : status === "failed" ? "warning" : "outline"}>{t(`runStatus.${status}`)}</Badge></div><CardDescription className="line-clamp-2 break-words">{run.prompt}</CardDescription></CardHeader>
            <CardContent><p className="min-h-12 whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere] line-clamp-4">{run.preview || run.error || t(`scheduled.runPreview.${["queued", "running", "retrying"].includes(status) ? "running" : "empty"}`)}</p></CardContent>
            <CardFooter className="mt-4 justify-between gap-3 text-xs text-muted-foreground"><span>{run.finishedAt ? t("scheduled.finishedAt", { date: new Date(run.finishedAt).toLocaleString() }) : t(`runStatus.${status}`)}</span>{run.threadId && <span className="flex items-center gap-1.5"><MessageSquare className="size-3.5" />{t("scheduled.openRun")}</span>}</CardFooter>
          </Card></li>;
        })}</ul><div className="mx-auto max-w-4xl"><ListPagination page={list.page} hasNext={list.hasNext} loading={list.loading} onPageChange={list.setPage} /></div>
      </>}
    </div>
  </section>;
}

export function ScheduledRunChatPage() {
  const { t } = useTranslation("automation"), { automationId = "", threadId = "" } = useParams();
  const { notifyTableMutated } = useOutletContext<AppOutletContext>();
  const [thread, setThread] = useState<{ title: string | null; custom: Record<string, unknown> } | null>(null), [error, setError] = useState<string | null>(null);
  useEffect(() => { let cancelled = false; setThread(null); setError(null); void api.getScheduledRunThread(automationId, threadId).then(thread => { if (!cancelled) setThread(thread); }).catch(error => { if (!cancelled) setError(error.message); }); return () => { cancelled = true; }; }, [automationId, threadId]);
  return <section className="flex min-h-0 flex-1 flex-col" data-testid="scheduled-run-chat">
    <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3"><Button asChild variant="ghost" size="sm"><Link to={`/app/schedules/${automationId}`}><ArrowLeft data-icon="inline-start" />{t("runs")}</Link></Button><h2 className="truncate text-sm font-medium">{thread?.title ?? t("scheduled.openRun")}</h2></header>
    {error ? <ListErrorState description={error} /> : !thread ? <p role="status" className="p-5">{t("loading")}</p> : <ChatPanel key={threadId} tableId={null} variant="session" remoteThreadId={threadId} scheduledTaskId={automationId} sessionAgentId={typeof thread.custom.agentId === "string" ? thread.custom.agentId : undefined} resourceKey={`schedule:${automationId}`} onMutated={notifyTableMutated} />}
  </section>;
}
