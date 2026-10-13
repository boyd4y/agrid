import { useCallback, useEffect, useRef, useState } from "react";
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
import { AUTOMATION_TRIGGER_LABELS, type AutomationRule } from "@tabdo/shared";

export function AutomationsPage() {
  const { t } = useTranslation(["app", "common", "errors"]);
  const [rules, setRules] = useState<(AutomationRule & { sourceName: string })[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const version = useRef(0);
  const load = useCallback(async () => {
    const current = ++version.current;
    setLoading(true);
    try { const result = await api.listWorkspaceAutomations(); if (current !== version.current) return; setRules(result.rules); setHasMore(result.hasMore); setError(null); }
    catch (error) { if (current === version.current) setError(error instanceof Error ? error.message : t("errors:loadFailed")); }
    finally { if (current === version.current) setLoading(false); }
  }, [t]);
  useEffect(() => { void load(); const unsubscribe = subscribeDataChanges(() => { void load(); }); return () => { version.current++; unsubscribe(); }; }, [load]);
  const more = async () => {
    setLoading(true);
    try { const next = await api.listWorkspaceAutomations(rules.length); setRules((previous) => [...previous, ...next.rules.filter((rule) => !previous.some((p) => p.id === rule.id))]); setHasMore(next.hasMore); setError(null); }
    catch (error) { setError(error instanceof Error ? error.message : t("errors:loadFailed")); }
    finally { setLoading(false); }
  };
  const create = <Button size="sm" asChild><Link to="/app/automations/new"><Plus data-icon="inline-start" />{t("automations.new")}</Link></Button>;
  return <AppPage data-testid="automations-hub" header={<AppPageHeader page="automations" description={t("automations.description")}><DataRefreshButton onRefresh={load} />{create}</AppPageHeader>}>
    {loading && !rules.length ? <p role="status" className="text-sm text-muted-foreground">{t("common:loading")}</p>
      : error && !rules.length ? <ListErrorState title={t("automations.listFailed")} description={error} onRetry={() => void load()} />
      : !rules.length ? <AppEmptyState className="flex-1" illustration={NOTIOLY.chill} title={t("automations.emptyTitle")} description={t("automations.emptyDescription")} action={create} />
      : <>
      {error && rules.length > 0 && <ListErrorState className="mb-4 min-h-0 py-4" title={error} onRetry={() => void load()} />}
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {rules.map((rule) => <li key={rule.id} className="flex items-center gap-3 px-4 py-3">
          <Zap className="size-5 shrink-0 text-warning" />
          <Link to={`/app/automations/${rule.id}`} className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="truncate text-sm font-medium">{rule.name}</div><div className="mt-1 truncate text-xs text-muted-foreground">{rule.sourceName} · {AUTOMATION_TRIGGER_LABELS[rule.trigger.type]}</div>
          </Link><span className={rule.enabled ? "text-xs text-success" : "text-xs text-muted-foreground"}>{rule.enabled ? t("common:enabled") : t("common:disabled")}</span>
          <AutomationActions rule={rule} onDeleted={(id) => setRules((previous) => previous.filter((rule) => rule.id !== id))} />
        </li>)}
      </ul>{hasMore && <Button variant="outline" className="mt-4 self-center" disabled={loading} onClick={() => void more()}>{t("common:more")}</Button>}
    </>}
  </AppPage>;
}
