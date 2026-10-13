import { useEffect, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, History } from "lucide-react";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { AutomationEditor } from "@/components/automation/AutomationPanel";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@tabdo/ui/components/select";
import { Button } from "@tabdo/ui/components/button";
import { DataRefreshButton } from "@/components/controls/data-refresh-button";
import { api, type MemberOption } from "@/lib/api";
import type { AppOutletContext } from "@/layouts/AppShell";
import type { FullTable } from "@/types/table";
import type { AutomationRule, AutomationRun } from "@tabdo/shared";

export function AutomationDetailPage() {
  const { t } = useTranslation("automation");
  const { automationId } = useParams(), navigate = useNavigate(), [search] = useSearchParams();
  const { tables, getTableRefreshToken } = useOutletContext<AppOutletContext>();
  const [rule, setRule] = useState<AutomationRule | null>(null), [tableId, setTableId] = useState(search.get("source") ?? "");
  const [table, setTable] = useState<FullTable | null>(null), [agents, setAgents] = useState<MemberOption[]>([]);
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(Boolean(automationId));
  const [runs, setRuns] = useState<AutomationRun[] | null>(null);
  const refreshToken = getTableRefreshToken(tableId);
  useEffect(() => { let cancelled = false; setRule(null); if (!automationId) { setLoading(false); return; } setLoading(true);
    void api.getAutomation(automationId).then((rule) => { if (!cancelled) { setRule(rule); setTableId(rule.tableId); setError(null); } }).catch((error) => { if (!cancelled) setError(error.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [automationId]);
  useEffect(() => { let cancelled = false; setTable(null); if (!tableId) return;
    void Promise.all([api.getTable(tableId), api.listMembers()]).then(([table, members]) => { if (!cancelled) { setTable(table); setAgents(members.members.filter((m) => m.kind === "agent")); setError(null); } }).catch((error) => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [tableId, refreshToken]);
  const loadRuns = async () => { try { setRuns(await api.listAutomationRuns(tableId, { automationId, limit: 30 })); setError(null); } catch (error) { setError(error instanceof Error ? error.message : t("loadFailed")); } };
  useEffect(() => { if (!runs || !automationId) return; const timer = window.setInterval(() => { if (!document.hidden) void loadRuns(); }, 5000); return () => window.clearInterval(timer); }, [automationId, tableId, runs !== null]);
  return <AppPage header={<AppPageHeader page="automations" description={automationId ? rule?.name ?? t("editAutomation") : t("newAutomation")}><Button asChild variant="ghost" size="sm"><Link to="/app/automations"><ArrowLeft data-icon="inline-start" />{t("backToList")}</Link></Button>{rule && <Button variant="outline" size="sm" onClick={() => void loadRuns()}><History data-icon="inline-start" />{t("runs")}</Button>}</AppPageHeader>}>
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : (!automationId || rule) && <>
      <div className="mx-auto mb-5 flex w-full max-w-3xl flex-col gap-2"><label className="text-sm font-medium" htmlFor="automation-source">{t("sourceTable")}</label>
        <Select value={tableId} onValueChange={setTableId} disabled={Boolean(rule)}><SelectTrigger id="automation-source"><SelectValue placeholder={t("pickTriggerTable")} /></SelectTrigger><SelectContent><SelectGroup>{tables.map((table) => <SelectItem key={table.id} value={table.id}>{table.name}</SelectItem>)}</SelectGroup></SelectContent></Select>
        {!tables.length && <p className="text-sm text-muted-foreground">{t("noSourceTable")}<Link to="/app/tables" className="text-primary underline">{t("createTableFirst")}</Link>.</p>}
      </div>
      {table ? <AutomationEditor key={`${table.id}:${rule?.id ?? "new"}`} tableId={table.id} columns={table.columns.filter((column) => !column.config.hidden)} members={agents} initial={rule} onClose={() => navigate("/app/automations")} onSaved={() => navigate("/app/automations")} /> : tableId && !error ? <p className="text-center text-sm text-muted-foreground">{t("readingSource")}</p> : null}
      {runs && <section className="mx-auto mt-6 w-full max-w-3xl rounded-xl border border-border p-4"><div className="mb-3 flex items-center justify-between"><h2 className="font-medium">{t("runs")}</h2><DataRefreshButton onRefresh={loadRuns} /></div>{!runs.length ? <p className="text-sm text-muted-foreground">{t("noRunRecords")}</p> : <ul className="flex flex-col gap-3">{runs.map((run) => <li key={run.id} className="text-sm"><div className="flex justify-between gap-2"><span>{t(`runStatus.${run.status}`)}</span><time className="text-xs text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</time></div>{run.error && <p className="mt-1 text-destructive">{run.error}</p>}{run.status === "failed" && run.eventId && <Button className="mt-2" variant="outline" size="sm" onClick={async () => { try { await api.replayAutomationRun(run.id); await loadRuns(); } catch (error) { setError(error instanceof Error ? error.message : t("replayFailed")); } }}>{t("replayPending")}</Button>}</li>)}</ul>}</section>}
    </>}
  </AppPage>;
}
