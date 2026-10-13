import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { History, LoaderCircle, X } from "lucide-react";
import type { AutomationRun } from "@tabdo/shared";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@tabdo/ui/components/sheet";
import { Button } from "@tabdo/ui/components/button";
import { DataRefreshButton } from "@/components/controls/data-refresh-button";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { api } from "@/lib/api";

export function AutomationRunsSheet({ tableId, automationId, name }: { tableId?: string; automationId: string; name: string }) {
  const { t } = useTranslation("automation");
  const [open, setOpen] = useState(false), [runs, setRuns] = useState<AutomationRun[] | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0), [replaying, setReplaying] = useState<string | null>(null);
  useEffect(() => { setOpen(false); setRuns(null); }, [automationId]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false, inFlight = false;
    const load = async (initial = false) => {
      if (inFlight) return;
      inFlight = true;
      if (initial) { setLoading(true); setError(null); }
      try {
        const result = await api.listRuleRuns(automationId);
        if (!cancelled) { setRuns(result); setError(null); }
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : t("loadFailed"));
      } finally {
        inFlight = false;
        if (!cancelled) setLoading(false);
      }
    };
    void load(true);
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [open, tableId, automationId, retry, t]);
  const refresh = () => setRetry(value => value + 1);
  const replay = async (run: AutomationRun) => {
    if (replaying) return;
    setReplaying(run.id);
    try { await api.replayAutomationRun(run.id); refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t("replayFailed")); }
    finally { setReplaying(null); }
  };
  return <Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger asChild><Button variant="outline" size="sm"><History data-icon="inline-start" />{t("runs")}</Button></SheetTrigger>
    <SheetContent data-testid="automation-runs-sheet">
      <SheetHeader>
        <div className="flex items-center justify-between gap-3">
          <SheetTitle className="font-semibold">{t("runs")}</SheetTitle>
          <div className="flex items-center gap-1">
            <DataRefreshButton disabled={loading} onRefresh={refresh} />
            <SheetClose asChild><Button variant="ghost" size="icon" aria-label={t("common:close")}><X /></Button></SheetClose>
          </div>
        </div>
        <SheetDescription className="truncate text-sm text-muted-foreground">{name}</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4" aria-busy={loading}>
        {error && <ListErrorState className="mb-4 min-h-0 flex-none py-4" title={t("loadFailed")} description={error} onRetry={refresh} />}
        {loading && runs === null ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{t("loading")}</p>
          : runs?.length === 0 && !error ? <p className="text-sm text-muted-foreground">{t("noRunRecords")}</p>
          : runs && <ul className="divide-y divide-border">{runs.map(run => <li key={run.id} className="py-3 text-sm first:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-2"><span>{t(`runStatus.${run.status}`)}</span><time className="text-xs text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</time></div>
            {run.status === "waiting_input" && run.threadId && <Button asChild variant="outline" size="sm" className="mt-2"><Link to={`/app?thread=${encodeURIComponent(run.threadId)}`}>{t("generic.openConversation")}</Link></Button>}
            {run.error && <p className="mt-2 break-words text-destructive">{run.error}</p>}
            {run.status === "failed" && run.eventId && <Button className="mt-2" variant="outline" size="sm" disabled={Boolean(replaying)} onClick={() => void replay(run)}>{replaying === run.id && <LoaderCircle className="size-4 animate-spin" />}{t("replayPending")}</Button>}
          </li>)}</ul>}
      </div>
    </SheetContent>
  </Sheet>;
}
