import { useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { Button } from "@tabdo/ui/components/button";
import { DataRefreshButton } from "@/components/controls/data-refresh-button";
import { AutomationActions } from "@/components/automation/AutomationActions";
import { AUTOMATION_SOURCE_ICONS } from "@/components/automation/automation-sources";
import { subscribeDataChanges } from "@/lib/data-changes";
import { useMemberOptions } from "@/hooks/useMemberOptions";
import { api } from "@/lib/api";
import { ListPagination } from "@/components/controls/list-pagination";
import { ListItemLink } from "@/components/controls/list-item-link";
import { useRemotePagination, type ListPageRequest } from "@/hooks/useListPagination";

async function loadRules({ offset, limit, signal }: ListPageRequest, kind: "event" | "schedule") {
  const result = await api.listWorkspaceAutomations(offset, limit, signal, kind);
  return { items: result.rules, hasMore: result.hasMore };
}

export function AutomationsPage({ scheduled = false }: { scheduled?: boolean }) {
  const { t } = useTranslation(["app", "common", "errors"]);
  const members = useMemberOptions();
  const listPath = scheduled ? "/app/schedules" : "/app/automations";
  const copy = scheduled ? "schedules" : "automations";
  const load = useCallback((request: ListPageRequest) => loadRules(request, scheduled ? "schedule" : "event"), [scheduled]);
  const pagination = useRemotePagination(load, t("errors:loadFailed"));
  const { items: rules, loading, error, refresh } = pagination;
  useEffect(() => subscribeDataChanges(() => { void refresh(); }), [refresh]);
  const create = <Button size="sm" asChild><Link to={`${listPath}/new`}><Plus data-icon="inline-start" />{t(`${copy}.new`)}</Link></Button>;
  return <AppPage contentWidth="standard" data-testid="automations-hub" header={<AppPageHeader page={scheduled ? "schedules" : "automations"} description={t(`${copy}.description`)}><DataRefreshButton onRefresh={refresh} />{create}</AppPageHeader>}>
    {loading && !rules.length ? <p role="status" className="text-sm text-muted-foreground">{t("common:loading")}</p>
      : error && !rules.length ? <ListErrorState title={t("automations.listFailed")} description={error} onRetry={() => void refresh()} />
      : !rules.length ? <AppEmptyState className="flex-1" illustration={NOTIOLY.chill} title={t(`${copy}.emptyTitle`)} description={t(`${copy}.emptyDescription`)} action={create} />
      : <>
      {error && rules.length > 0 && <ListErrorState className="mb-4 min-h-0 py-4" title={error} onRetry={() => void refresh()} />}
      <ul aria-busy={loading} className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {rules.map((rule) => { const Icon = AUTOMATION_SOURCE_ICONS[rule.source.kind]; const agentAction = rule.actions.find(action => action.type === "run_agent"); const agent = agentAction?.type === "run_agent" ? members.find(member => member.userId === agentAction.agentUserId) : null; const time = rule.source.kind === "schedule" ? (() => { const [minute, hour, , , day] = rule.source.cron.split(/\s+/); return /^\d+ \d+ \* \* (\*|[0-6])$/.test(rule.source.cron) ? `${t(`automation:generic.schedule.${day === "*" ? "daily" : "weekly"}`)}${day !== "*" ? ` ${t(`automation:generic.schedule.days.${day}`)}` : ""} ${hour.padStart(2, "0")}:${minute.padStart(2, "0")} · ${rule.source.timeZone}` : `${rule.source.cron} · ${rule.source.timeZone}`; })() : ""; return <li key={rule.id} className="relative flex items-center gap-3 px-4 py-3" data-testid="automation-list-item">
          <ListItemLink to={`${listPath}/${rule.id}`} label={rule.name} />
          <Icon className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{rule.name}</div><div className="mt-1 truncate text-xs text-muted-foreground">{scheduled ? `${agent?.name ?? t("automation:pickAgent")} · ${time}` : `${rule.sourceName ?? t(`automation:generic.sources.${rule.source.kind}`)} · ${t(`automation:triggers.${rule.trigger.type}`)}`}</div>{scheduled && agentAction?.type === "run_agent" && <p className="mt-1 truncate text-xs text-muted-foreground">{agentAction.prompt}</p>}
          </div><span className={rule.enabled ? "text-xs text-success" : "text-xs text-muted-foreground"}>{rule.enabled ? t("common:enabled") : t("common:disabled")}</span>
          <div className="relative z-10 shrink-0"><AutomationActions rule={rule} onDeleted={() => { void refresh(); }} /></div>
        </li>; })}
      </ul><ListPagination page={pagination.page} hasNext={pagination.hasNext} loading={loading} onPageChange={pagination.setPage} />
    </>}
  </AppPage>;
}
