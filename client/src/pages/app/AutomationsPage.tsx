import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Zap, RefreshCw } from "lucide-react";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { Button } from "@/components/ui/button";
import { DataRefreshButton } from "@/components/ui/data-refresh-button";
import { AutomationActions } from "@/components/automation/AutomationActions";
import { subscribeDataChanges } from "@/lib/data-changes";
import { api } from "@/lib/api";
import { AUTOMATION_TRIGGER_LABELS, type AutomationRule } from "@tabdo/shared";

export function AutomationsPage() {
  const [rules, setRules] = useState<(AutomationRule & { sourceName: string })[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const version = useRef(0);
  const load = useCallback(async () => {
    const current = ++version.current;
    setLoading(true);
    try { const result = await api.listWorkspaceAutomations(); if (current !== version.current) return; setRules(result.rules); setHasMore(result.hasMore); setError(null); }
    catch (error) { if (current === version.current) setError(error instanceof Error ? error.message : "加载失败"); }
    finally { if (current === version.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); const unsubscribe = subscribeDataChanges(() => { void load(); }); return () => { version.current++; unsubscribe(); }; }, [load]);
  const more = async () => {
    setLoading(true);
    try { const next = await api.listWorkspaceAutomations(rules.length); setRules((previous) => [...previous, ...next.rules.filter((rule) => !previous.some((p) => p.id === rule.id))]); setHasMore(next.hasMore); setError(null); }
    catch (error) { setError(error instanceof Error ? error.message : "加载失败"); }
    finally { setLoading(false); }
  };
  const create = <Button size="sm" asChild><Link to="/app/automations/new"><Plus data-icon="inline-start" />新建自动化</Link></Button>;
  return <AppPage data-testid="automations-hub" header={<AppPageHeader page="automations" description="选择数据来源，用触发、条件和动作完成自动化。"><DataRefreshButton onRefresh={load} />{create}</AppPageHeader>}>
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    {loading && !rules.length ? <p role="status" className="text-sm text-muted-foreground">加载中…</p> : error && !rules.length ? <div className="flex flex-1 flex-col items-center justify-center gap-3"><p className="text-sm text-muted-foreground">自动化列表未能加载</p><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw data-icon="inline-start" />重新加载</Button></div> : !rules.length ? <AppEmptyState className="flex-1" illustration={NOTIOLY.chill} title="还没有自动化" description="新建自动化并选择来源表格，让重复操作自动完成。" action={create} /> : <>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {rules.map((rule) => <li key={rule.id} className="flex items-center gap-3 px-4 py-3">
          <Zap className="size-5 shrink-0 text-warning" />
          <Link to={`/app/automations/${rule.id}`} className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="truncate text-sm font-medium">{rule.name}</div><div className="mt-1 truncate text-xs text-muted-foreground">{rule.sourceName} · {AUTOMATION_TRIGGER_LABELS[rule.trigger.type]}</div>
          </Link><span className={rule.enabled ? "text-xs text-success" : "text-xs text-muted-foreground"}>{rule.enabled ? "已启用" : "已停用"}</span>
          <AutomationActions rule={rule} onDeleted={(id) => setRules((previous) => previous.filter((rule) => rule.id !== id))} />
        </li>)}
      </ul>{hasMore && <Button variant="outline" className="mt-4 self-center" disabled={loading} onClick={() => void more()}>加载更多</Button>}
    </>}
  </AppPage>;
}
