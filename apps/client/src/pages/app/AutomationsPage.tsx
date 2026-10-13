import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Plus, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { Button } from "@tabdo/ui/components/button";
import { DataRefreshButton } from "@/components/controls/data-refresh-button";
import { AutomationActions } from "@/components/automation/AutomationActions";
import { subscribeDataChanges } from "@/lib/data-changes";
import { api } from "@/lib/api";
import { AUTOMATION_TRIGGER_LABELS } from "@tabdo/shared";
import { ListPagination } from "@/components/controls/list-pagination";
import { ListItemLink } from "@/components/controls/list-item-link";
import { useRemotePagination, type ListPageRequest } from "@/hooks/useListPagination";

async function loadRules({ offset, limit, signal }: ListPageRequest) {
  const result = await api.listWorkspaceAutomations(offset, limit, signal);
  return { items: result.rules, hasMore: result.hasMore };
}

export function AutomationsPage() {
  const { t } = useTranslation(["app", "common", "errors"]);
  const pagination = useRemotePagination(loadRules, t("errors:loadFailed"));
  const { items: rules, loading, error, refresh } = pagination;
  useEffect(() => subscribeDataChanges(() => { void refresh(); }), [refresh]);
  const create = <Button size="sm" asChild><Link to="/app/automations/new"><Plus data-icon="inline-start" />{t("automations.new")}</Link></Button>;
  return <AppPage contentWidth="standard" data-testid="automations-hub" header={<AppPageHeader page="automations" description={t("automations.description")}><DataRefreshButton onRefresh={refresh} />{create}</AppPageHeader>}>
    {loading && !rules.length ? <p role="status" className="text-sm text-muted-foreground">{t("common:loading")}</p>
      : error && !rules.length ? <ListErrorState title={t("automations.listFailed")} description={error} onRetry={() => void refresh()} />
      : !rules.length ? <AppEmptyState className="flex-1" illustration={NOTIOLY.chill} title={t("automations.emptyTitle")} description={t("automations.emptyDescription")} action={create} />
      : <>
      {error && rules.length > 0 && <ListErrorState className="mb-4 min-h-0 py-4" title={error} onRetry={() => void refresh()} />}
      <ul aria-busy={loading} className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {rules.map((rule) => <li key={rule.id} className="relative flex items-center gap-3 px-4 py-3" data-testid="automation-list-item">
          <ListItemLink to={`/app/automations/${rule.id}`} label={rule.name} />
          <Zap className="size-5 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{rule.name}</div><div className="mt-1 truncate text-xs text-muted-foreground">{rule.sourceName} · {AUTOMATION_TRIGGER_LABELS[rule.trigger.type]}</div>
          </div><span className={rule.enabled ? "text-xs text-success" : "text-xs text-muted-foreground"}>{rule.enabled ? t("common:enabled") : t("common:disabled")}</span>
          <div className="relative z-10 shrink-0"><AutomationActions rule={rule} onDeleted={() => { void refresh(); }} /></div>
        </li>)}
      </ul><ListPagination page={pagination.page} hasNext={pagination.hasNext} loading={loading} onPageChange={pagination.setPage} />
    </>}
  </AppPage>;
}
