import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { Link, useOutletContext } from "react-router-dom";
import { NiPlus, NiTable, NiZap } from "@/components/icons";
import type { AppOutletContext } from "@/layouts/AppShell";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { AutomationActions } from "@/components/automation/AutomationActions";
import type { AutomationRule } from "@table/shared";

/**
 * Workspace-level automations hub. Per-table rules stay at
 * /app/tables/:tableId/automations.
 */
export function AutomationsPage() {
  const { tables, tablesLoading } = useOutletContext<AppOutletContext>();
  const [rules, setRules] = useState<Record<string, AutomationRule[]>>({});
  const [failedTables, setFailedTables] = useState<string[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (tablesLoading) return;
    let cancelled = false;
    setRulesLoading(true);
    void Promise.allSettled(tables.map((table) => api.listAutomations(table.id)))
      .then((results) => {
        if (cancelled) return;
        const next: Record<string, AutomationRule[]> = {};
        const failed: string[] = [];
        results.forEach((result, index) => {
          const id = tables[index].id;
          if (result.status === "fulfilled") next[id] = result.value;
          else failed.push(id);
        });
        setRules(next);
        setFailedTables(failed);
        setRulesLoading(false);
      });
    return () => { cancelled = true; };
  }, [tables, tablesLoading, retry]);

  return (
    <AppPage data-testid="automations-hub" header={
      <AppPageHeader page="automations" description="按表格管理当 / 如果 / 就规则" />
    }>

      {tablesLoading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : tables.length === 0 ? (
        <AppEmptyState className="flex-1" illustration={NOTIOLY.chill} title="还没有自动化" description="先创建一张表格，再配置自动化规则。" action={<Button asChild size="sm"><Link to="/app/tables"><NiPlus className="h-4 w-4" />去新建表格</Link></Button>} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] items-start gap-3">
          {tables.map((t) => (
            <section key={t.id} className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
            <Link
              to={`/app/tables/${t.id}/automations`}
              className="flex items-start gap-3 p-4 transition hover:bg-accent"
              data-testid={`automations-hub-${t.id}`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning/10">
                <NiZap className="h-4 w-4 text-warning" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{t.name}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <NiTable className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    {t.description || "打开该表的自动化规则"}
                  </span>
                </div>
              </div>
            </Link>
            <div className="border-t border-border">
              {rulesLoading ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">加载规则中…</p>
              ) : failedTables.includes(t.id) ? (
                <div className="flex items-center justify-between px-4 py-3 text-xs text-destructive">
                  加载规则失败
                  <Button size="sm" variant="outline" onClick={() => setRetry((value) => value + 1)}>重试</Button>
                </div>
              ) : (rules[t.id] ?? []).length === 0 ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">暂无规则，点击表格配置自动化。</p>
              ) : (
                <ul className="divide-y divide-border">
                  {rules[t.id].map((rule) => (
                    <li key={rule.id} className="flex items-center gap-2 px-4 py-2">
                      <Link to={`/app/tables/${t.id}/automations`} className="min-w-0 flex-1 truncate rounded-sm text-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{rule.name}</Link>
                      <span className={rule.enabled ? "text-xs text-success" : "text-xs text-muted-foreground"}>{rule.enabled ? "已启用" : "已停用"}</span>
                      <AutomationActions rule={rule} onDeleted={(id) => setRules((previous) => ({ ...previous, [t.id]: previous[t.id].filter((item) => item.id !== id) }))} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            </section>
          ))}
        </div>
      )}
    </AppPage>
  );
}
