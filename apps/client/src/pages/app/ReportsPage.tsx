import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChartNoAxesCombined, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { Button } from "@tabdo/ui/components/button";
import { DataRefreshButton } from "@/components/controls/data-refresh-button";
import { DeleteConfirmation } from "@/components/controls/delete-confirmation";
import { api } from "@/lib/api";
import { subscribeDataChanges } from "@/lib/data-changes";
import type { Report } from "@tabdo/shared";

export function ReportsPage() {
  const { t } = useTranslation(["app", "common", "errors"]);
  const [reports, setReports] = useState<Report[]>([]), [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(true), [hasMore, setHasMore] = useState(false), [deleting, setDeleting] = useState<Report | null>(null);
  const version = useRef(0);
  const load = useCallback(async () => {
    const current = ++version.current; setLoading(true);
    try { const result = await api.listReports(); if (current !== version.current) return; setReports(result.reports); setHasMore(result.hasMore); setError(null); }
    catch (error) { if (current === version.current) setError(error instanceof Error ? error.message : t("errors:loadFailed")); }
    finally { if (current === version.current) setLoading(false); }
  }, [t]);
  useEffect(() => { void load(); const unsubscribe = subscribeDataChanges(() => { void load(); }); return () => { version.current++; unsubscribe(); }; }, [load]);
  const create = <Button asChild size="sm"><Link to="/app/reports/new"><Plus data-icon="inline-start" />{t("reports.new")}</Link></Button>;
  return <AppPage header={<AppPageHeader page="reports" description={t("reports.description")}><DataRefreshButton onRefresh={load} />{create}</AppPageHeader>}>
    {loading && !reports.length ? <p className="text-sm text-muted-foreground">{t("common:loading")}</p>
      : error && !reports.length ? <ListErrorState title={t("errors:listLoadFailedNamed", { name: t("nav.reports") })} description={error} onRetry={() => void load()} />
      : !reports.length ? <AppEmptyState className="flex-1" illustration={NOTIOLY.planning} title={t("reports.emptyTitle")} description={t("reports.emptyDescription")} action={create} />
      : <>
    {error && reports.length > 0 && <ListErrorState className="mb-4 min-h-0 py-4" title={error} onRetry={() => void load()} />}
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3">{reports.map((report) => <article key={report.id} className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"><ChartNoAxesCombined className="mt-1 size-5 shrink-0 text-primary" /><Link to={`/app/reports/${report.id}`} className="min-w-0 flex-1"><h2 className="truncate text-sm font-medium">{report.name}</h2><p className="mt-1 text-xs text-muted-foreground">{t("reports.widgetCount", { count: report.widgets.length, layout: report.columns === 2 ? t("reports.layoutDouble") : t("reports.layoutSingle") })}</p></Link><Button variant="destructive-ghost" size="icon" aria-label={t("reports.deleteAria", { name: report.name })} onClick={() => setDeleting(report)}><Trash2 /></Button></article>)}</div>
    {hasMore && <Button className="mt-4 self-center" variant="outline" disabled={loading} onClick={async () => { setLoading(true); try { const next = await api.listReports(reports.length); setReports((previous) => [...previous, ...next.reports]); setHasMore(next.hasMore); } catch (error) { setError(error instanceof Error ? error.message : t("errors:loadFailed")); } finally { setLoading(false); } }}>{t("common:more")}</Button>}
    </>}
    <DeleteConfirmation open={Boolean(deleting)} onOpenChange={(open) => { if (!open) setDeleting(null); }} title={t("reports.deleteTitle")} description={t("reports.deleteDescription", { name: deleting?.name ?? "" })} onConfirm={async () => { if (deleting) { await api.deleteReport(deleting.id); setReports((previous) => previous.filter((report) => report.id !== deleting.id)); } }} />
  </AppPage>;
}
