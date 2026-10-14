import { useCallback, useEffect } from "react";
import { Link, Outlet, useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { CalendarClock, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AutomationRule } from "@tabdo/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useRemotePagination, type ListPageRequest } from "@/hooks/useListPagination";
import { useMemberOptions } from "@/hooks/useMemberOptions";
import { subscribeDataChanges } from "@/lib/data-changes";
import { Button } from "@tabdo/ui/components/button";
import { Badge } from "@tabdo/ui/components/badge";
import { AppPageHeader } from "@/components/shell/AppPage";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { DataRefreshButton } from "@/components/controls/data-refresh-button";
import { AutomationActions } from "@/components/automation/AutomationActions";
import { ListItemLink } from "@/components/controls/list-item-link";
import type { AppOutletContext } from "@/layouts/AppShell";

export function scheduleLabel(rule: AutomationRule, t: (key: string) => string) {
  if (rule.source.kind !== "schedule") return "";
  const [minute, hour, , , day] = rule.source.cron.split(/\s+/);
  const time = /^\d+ \d+ \* \* (\*|[0-6])$/.test(rule.source.cron)
    ? `${t(`generic.schedule.${day === "*" ? "daily" : "weekly"}`)}${day === "*" ? "" : ` ${t(`generic.schedule.days.${day}`)}`} ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`
    : rule.source.cron;
  return `${time} · ${rule.source.timeZone}`;
}

export function SchedulesPage() {
  const { t } = useTranslation("automation");
  const context = useOutletContext<AppOutletContext>();
  const { automationId } = useParams(), location = useLocation(), navigate = useNavigate();
  const members = useMemberOptions();
  const load = useCallback(async ({ offset, limit, signal }: ListPageRequest) => {
    const result = await api.listWorkspaceAutomations(offset, limit, signal, "schedule");
    return { items: result.rules, hasMore: result.hasMore };
  }, []);
  const list = useRemotePagination(load, t("loadFailed"));
  useEffect(() => subscribeDataChanges(() => { void list.refresh(); }), [list.refresh]);
  useEffect(() => {
    if (location.pathname === "/app/schedules" && list.items.length) navigate(`/app/schedules/${list.items[0].id}`, { replace: true });
  }, [location.pathname, list.items, navigate]);
  return <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col" data-testid="schedules-workspace">
    <AppPageHeader page="schedules" className="py-4" />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
      <aside className="flex max-h-64 w-full shrink-0 flex-col border-b border-border bg-muted/30 md:max-h-none md:w-72 md:border-b-0 md:border-r" aria-label={t("scheduled.tasks")} data-testid="scheduled-task-sidebar">
        <div className="flex items-center justify-between gap-2 p-3"><span className="text-sm font-medium">{t("scheduled.tasks")}</span><div className="flex items-center gap-1"><DataRefreshButton onRefresh={list.refresh} disabled={list.loading} /><Button asChild variant="ghost" size="icon"><Link to="/app/schedules/new" aria-label={t("scheduled.new")}><Plus /></Link></Button></div></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-busy={list.loading}>
          {list.error && <ListErrorState className="min-h-0 py-4" description={list.error} onRetry={list.refresh} />}
          {!list.items.length && !list.error && <p className="px-2 py-3 text-sm text-muted-foreground">{t(list.loading ? "loading" : "scheduled.noTasks")}</p>}
          <ul className="flex flex-col gap-1">{list.items.map(rule => {
            const action = rule.actions.find(action => action.type === "run_agent");
            const agent = action?.type === "run_agent" ? members.find(member => member.userId === action.agentUserId) : undefined;
            return <li key={rule.id} className={cn("relative rounded-lg p-3 transition-colors hover:bg-accent", rule.id === automationId && "bg-accent")} data-testid="scheduled-task-item" data-selected={rule.id === automationId}>
              <ListItemLink to={`/app/schedules/${rule.id}`} label={rule.name} aria-current={rule.id === automationId ? "page" : undefined} />
              <div className="flex items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{rule.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{agent?.name ?? t("pickAgent")}</p></div><div className="relative z-10 -mt-1 -mr-1"><AutomationActions rule={rule} onDeleted={async () => { await list.refresh(); if (rule.id === automationId) navigate("/app/schedules", { replace: true }); }} /></div></div>
              <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground"><CalendarClock className="size-3.5 shrink-0" /><span className="break-words">{scheduleLabel(rule, t)}</span></p>
              <Badge variant={rule.enabled ? "outline" : "secondary"} className="mt-2">{t(rule.enabled ? "enabled" : "scheduled.paused")}</Badge>
            </li>;
          })}</ul>
        </div>
        {(list.page > 1 || list.hasNext) && <nav className="flex items-center justify-between border-t border-border p-3" aria-label={t("common:pagination.label")}><Button variant="ghost" size="icon" disabled={list.loading || list.page <= 1} onClick={() => list.setPage(list.page - 1)} aria-label={t("common:pagination.previous")}><ChevronLeft /></Button><span className="text-xs text-muted-foreground">{t("common:pagination.page", { page: list.page })}</span><Button variant="ghost" size="icon" disabled={list.loading || !list.hasNext} onClick={() => list.setPage(list.page + 1)} aria-label={t("common:pagination.next")}><ChevronRight /></Button></nav>}
      </aside>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"><Outlet key={automationId ?? location.pathname} context={context} /></main>
    </div>
  </div>;
}
