import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { ArrowLeft, Eye, Pencil, Save, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { AppPageHeader } from "@/components/shell/AppPage";
import { Button } from "@tabdo/ui/components/button";
import { DataRefreshButton } from "@/components/controls/data-refresh-button";
import { ReportBuilder } from "@/components/reports/ReportBuilder";
import { api } from "@/lib/api";
import { subscribeDataChanges } from "@/lib/data-changes";
import type { AppOutletContext } from "@/layouts/AppShell";
import type { ReportPageConfig } from "@tabdo/shared";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
const EMPTY: ReportPageConfig = { name: i18n.t("reports:newReport"), description: "", columns: 2, widgets: [] };
export function ReportDetailPage() {
  const { t } = useTranslation(["reports", "common"]);
  const { reportId } = useParams(), { tables } = useOutletContext<AppOutletContext>(), navigate = useNavigate();
  const [config, setConfig] = useState<ReportPageConfig>(EMPTY), [history, setHistory] = useState<ReportPageConfig[]>([]), [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false), [loading, setLoading] = useState(Boolean(reportId)), [error, setError] = useState<string | null>(null), [conflict, setConflict] = useState(false), [mode, setMode] = useState<"design" | "preview">("design"), [refresh, setRefresh] = useState(0), [reload, setReload] = useState(0);
  const version = useRef(0), isDirty = useRef(false), request = useRef(0);
  const onError = useCallback((error: Error) => { setError(error.message); }, []);
  const restore = useCallback((report: Awaited<ReturnType<typeof api.getReport>>) => { const { name, description, columns, widgets } = report;setConfig({ name, description, columns, widgets });version.current = report.version;isDirty.current = false;setDirty(false);setConflict(false);setHistory([]);setError(null); }, []);
  useEffect(() => { const current = ++request.current;setConfig(EMPTY);setHistory([]);setDirty(false);isDirty.current = false;setConflict(false);setError(null);version.current = 0;
    if (!reportId) { setLoading(false);return; } setLoading(true);
    void api.getReport(reportId).then((report) => { if (current === request.current) restore(report); }).catch((e) => { if (current === request.current) setError(e.message); }).finally(() => { if (current === request.current) setLoading(false); });return () => { request.current++; }; }, [reportId, reload, restore]);
  const sourceIds = config.widgets.flatMap((w) => w.type === "text" || !w.query.tableId ? [] : [w.query.tableId]);
  const sources = sourceIds.join(",");
  useEffect(() => { let cancelled = false;const unsubscribe = subscribeDataChanges((change) => {
    if (change.all || change.tableIds.some((id) => sources.split(",").includes(id))) setRefresh((n) => n + 1);
    if (reportId && change.all) void api.getReport(reportId).then((report) => { if (cancelled || report.version === version.current) return;if (isDirty.current) setConflict(true);else restore(report); }).catch((e) => { if (!cancelled) setError(e.message); });
  });return () => { cancelled = true;unsubscribe(); }; }, [reportId, sources, restore]);
  const change = (next: ReportPageConfig) => { setHistory((past) => [...past.slice(-19), config]);setConfig(next);setDirty(true);isDirty.current = true;setError(null); };
  const save = async () => { setSaving(true);try { const report = await api.saveReport(config, reportId, version.current);restore(report);toast.success(t("saved"));if (!reportId) navigate(`/app/reports/${report.id}`, { replace: true }); } catch (error) { setError(error instanceof Error ? error.message : t("saveFailed")); } finally { setSaving(false); } };
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="report-builder-page">
    <AppPageHeader page="reports" description={config.name}><Button variant="ghost" size="sm" asChild><Link to="/app/reports"><ArrowLeft data-icon="inline-start" />{t("backToList")}</Link></Button><DataRefreshButton onRefresh={() => setRefresh((n) => n + 1)} />
      <Button variant="ghost" size="icon" aria-label={t("undoEdits")} disabled={!history.length} onClick={() => { const previous = history.at(-1);if (previous) { setConfig(previous);setHistory((past) => past.slice(0, -1));setDirty(true);isDirty.current = true; } }}><Undo2 /></Button>
      <Button variant="outline" size="sm" onClick={() => setMode((m) => m === "design" ? "preview" : "design")}>{mode === "design" ? <Eye data-icon="inline-start" /> : <Pencil data-icon="inline-start" />}{mode === "design" ? t("previewPage") : t("editPage")}</Button>
      <Button size="sm" disabled={!config.name.trim() || saving || loading || (Boolean(reportId) && !dirty)} onClick={() => void save()}><Save data-icon="inline-start" />{saving ? t("saving") : dirty ? t("saveChanges") : t("saveReport")}</Button>
    </AppPageHeader>
    {conflict && <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-muted px-5 py-2 text-xs"><span>{t("conflictHint")}</span><Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>{t("discardLocal")}</Button></div>}
    {error && <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-5 py-2 text-sm" role="alert"><span className="text-destructive">{error}</span><Button size="sm" variant="ghost" onClick={() => { setRefresh((n) => n + 1);if (reportId && version.current === 0) setReload((n) => n + 1);setError(null); }}>{t("common:retry")}</Button>{reportId && version.current > 0 && <Button variant="ghost" size="sm" onClick={() => setReload((n) => n + 1)}>{t("reloadReport")}</Button>}</div>}
    {loading ? <p className="p-6 text-sm text-muted-foreground">{t("readingPage")}</p> : reportId && version.current === 0 ? <p className="p-6 text-sm text-muted-foreground">{t("loadFailedRetry")}</p> : <div inert={saving} className="flex min-h-0 flex-1 flex-col"><ReportBuilder config={config} onChange={change} tables={tables} mode={mode} refreshToken={refresh} onError={onError} /></div>}
  </div>;
}
