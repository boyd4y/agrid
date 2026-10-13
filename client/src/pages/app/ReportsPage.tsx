import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChartNoAxesCombined, Plus, Trash2, RefreshCw } from "lucide-react";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { Button } from "@/components/ui/button";
import { DataRefreshButton } from "@/components/ui/data-refresh-button";
import { DeleteConfirmation } from "@/components/ui/delete-confirmation";
import { api } from "@/lib/api";
import { subscribeDataChanges } from "@/lib/data-changes";
import type { Report } from "@tabdo/shared";
export function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]), [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(true), [hasMore, setHasMore] = useState(false), [deleting, setDeleting] = useState<Report | null>(null);
  const version = useRef(0);
  const load = useCallback(async () => { const current = ++version.current; setLoading(true); try { const result = await api.listReports(); if (current !== version.current) return; setReports(result.reports); setHasMore(result.hasMore); setError(null); } catch (error) { if (current === version.current) setError(error instanceof Error ? error.message : "加载失败"); } finally { if (current === version.current) setLoading(false); } }, []);
  useEffect(() => { void load(); const unsubscribe = subscribeDataChanges(() => { void load(); }); return () => { version.current++; unsubscribe(); }; }, [load]);
  const create = <Button asChild size="sm"><Link to="/app/reports/new"><Plus data-icon="inline-start" />新建报告</Link></Button>;
  return <AppPage header={<AppPageHeader page="reports" description="从表格中汇总数据，查看分布与趋势。"><DataRefreshButton onRefresh={load} />{create}</AppPageHeader>}>
    {error && reports.length > 0 && <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 text-sm text-destructive"><span>{error}</span><Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}><RefreshCw data-icon="inline-start" />重新加载</Button></div>}
    {loading && !reports.length ? <p className="text-sm text-muted-foreground">加载中…</p> : error && !reports.length ? <div className="flex flex-1 flex-col items-center justify-center gap-3"><p role="alert" className="text-sm text-muted-foreground">{error}</p><Button variant="outline" size="sm" onClick={() => void load()}>重新加载</Button></div> : !reports.length ? <AppEmptyState className="flex-1" illustration={NOTIOLY.planning} title="还没有报告" description="选择表格和汇总字段，创建你的第一份报告。" action={create} /> : <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3">{reports.map((report) => <article key={report.id} className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"><ChartNoAxesCombined className="mt-1 size-5 shrink-0 text-primary" /><Link to={`/app/reports/${report.id}`} className="min-w-0 flex-1"><h2 className="truncate text-sm font-medium">{report.name}</h2><p className="mt-1 text-xs text-muted-foreground">{report.widgets.length} 个组件 · {report.columns === 2 ? "双列页面" : "单列页面"}</p></Link><Button variant="destructive-ghost" size="icon" aria-label={`删除报告：${report.name}`} onClick={() => setDeleting(report)}><Trash2 /></Button></article>)}</div>}
    {hasMore && <Button className="mt-4 self-center" variant="outline" disabled={loading} onClick={async () => { setLoading(true); try { const next = await api.listReports(reports.length); setReports((previous) => [...previous, ...next.reports]); setHasMore(next.hasMore); } catch (error) { setError(error instanceof Error ? error.message : "加载失败"); } finally { setLoading(false); } }}>加载更多</Button>}
    <DeleteConfirmation open={Boolean(deleting)} onOpenChange={(open) => { if (!open) setDeleting(null); }} title="删除报告？" description={`将永久删除「${deleting?.name ?? ""}」的配置，来源表格数据会保留。`} onConfirm={async () => { if (deleting) { await api.deleteReport(deleting.id); setReports((previous) => previous.filter((report) => report.id !== deleting.id)); } }} />
  </AppPage>;
}
