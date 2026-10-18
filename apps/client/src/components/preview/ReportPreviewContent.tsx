import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Report } from "@tabdo/shared";
import { Button } from "@tabdo/ui/components/button";
import { ReportBuilder } from "@/components/reports/ReportBuilder";
import { api } from "@/lib/api";
import { subscribeDataChanges } from "@/lib/data-changes";
import type { PreviewSlotContext } from "./preview-slot";

export function ReportPreviewContent({ reportId, refreshToken = 0, onHeaderChange }: PreviewSlotContext) {
  const { t } = useTranslation("common");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const onError = useCallback((cause: Error) => setError(cause.message), []);
  useEffect(() => subscribeDataChanges(() => setReload(n => n + 1)), []);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(null);
    if (reportId) void api.getReport(reportId).then(value => { if (current) setReport(value); }).catch(cause => { if (current) setError(cause.message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [reportId, refreshToken, reload]);
  useEffect(() => {
    onHeaderChange?.({ title: report?.name, refresh: { run: () => setReload(n => n + 1), busy: loading } });
    return () => onHeaderChange?.(null);
  }, [report?.name, loading, onHeaderChange]);
  return <div className="flex h-full min-h-0 min-w-0 flex-col p-3" data-testid="preview-slot-report">
    {error && <div role="alert" className="flex items-center gap-2 text-sm text-destructive"><span className="min-w-0 break-words">{error}</span><Button variant="ghost" size="sm" onClick={() => setReload(n => n + 1)}>{t("retry")}</Button></div>}
    {loading && !report ? <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p> : report && <ReportBuilder config={report} tables={[]} mode="preview" onChange={() => {}} refreshToken={refreshToken + reload} onError={onError} />}
  </div>;
}
