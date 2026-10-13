import { useEffect, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, History } from "lucide-react";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { AutomationEditor } from "@/components/automation/AutomationPanel";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DataRefreshButton } from "@/components/ui/data-refresh-button";
import { api, type MemberOption } from "@/lib/api";
import type { AppOutletContext } from "@/layouts/AppShell";
import type { FullTable } from "@/types/table";
import type { AutomationRule, AutomationRun } from "@tabdo/shared";
const RUN_LABELS = { queued: "排队中", running: "执行中", retrying: "等待重试", completed: "已完成", failed: "失败", skipped: "条件未满足", cancelled: "已取消", superseded: "输入已更新", unknown: "结果待确认" };

export function AutomationDetailPage() {
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
  const loadRuns = async () => { try { setRuns(await api.listAutomationRuns(tableId, { automationId, limit: 30 })); setError(null); } catch (error) { setError(error instanceof Error ? error.message : "加载失败"); } };
  useEffect(() => { if (!runs || !automationId) return; const timer = window.setInterval(() => { if (!document.hidden) void loadRuns(); }, 5000); return () => window.clearInterval(timer); }, [automationId, tableId, runs !== null]);
  return <AppPage header={<AppPageHeader page="automations" description={automationId ? rule?.name ?? "编辑自动化" : "新建自动化"}><Button asChild variant="ghost" size="sm"><Link to="/app/automations"><ArrowLeft data-icon="inline-start" />返回列表</Link></Button>{rule && <Button variant="outline" size="sm" onClick={() => void loadRuns()}><History data-icon="inline-start" />运行记录</Button>}</AppPageHeader>}>
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    {loading ? <p className="text-sm text-muted-foreground">加载中…</p> : (!automationId || rule) && <>
      <div className="mx-auto mb-5 flex w-full max-w-3xl flex-col gap-2"><label className="text-sm font-medium" htmlFor="automation-source">来源表格</label>
        <Select value={tableId} onValueChange={setTableId} disabled={Boolean(rule)}><SelectTrigger id="automation-source"><SelectValue placeholder="选择触发自动化的表格" /></SelectTrigger><SelectContent><SelectGroup>{tables.map((table) => <SelectItem key={table.id} value={table.id}>{table.name}</SelectItem>)}</SelectGroup></SelectContent></Select>
        {!tables.length && <p className="text-sm text-muted-foreground">还没有来源表格，<Link to="/app/tables" className="text-primary underline">先创建表格</Link>。</p>}
      </div>
      {table ? <AutomationEditor key={`${table.id}:${rule?.id ?? "new"}`} tableId={table.id} columns={table.columns.filter((column) => !column.config.hidden)} members={agents} initial={rule} onClose={() => navigate("/app/automations")} onSaved={() => navigate("/app/automations")} /> : tableId && !error ? <p className="text-center text-sm text-muted-foreground">读取来源字段…</p> : null}
      {runs && <section className="mx-auto mt-6 w-full max-w-3xl rounded-xl border border-border p-4"><div className="mb-3 flex items-center justify-between"><h2 className="font-medium">运行记录</h2><DataRefreshButton onRefresh={loadRuns} /></div>{!runs.length ? <p className="text-sm text-muted-foreground">还没有运行记录。</p> : <ul className="flex flex-col gap-3">{runs.map((run) => <li key={run.id} className="text-sm"><div className="flex justify-between gap-2"><span>{RUN_LABELS[run.status]}</span><time className="text-xs text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</time></div>{run.error && <p className="mt-1 text-destructive">{run.error}</p>}{run.status === "failed" && run.eventId && <Button className="mt-2" variant="outline" size="sm" onClick={async () => { try { await api.replayAutomationRun(run.id); await loadRuns(); } catch (error) { setError(error instanceof Error ? error.message : "重放失败"); } }}>重放未完成步骤</Button>}</li>)}</ul>}</section>}
    </>}
  </AppPage>;
}
