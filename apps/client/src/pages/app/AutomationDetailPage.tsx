import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Check, History, LoaderCircle } from "lucide-react";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { AutomationEditor } from "@/components/automation/AutomationPanel";
import { TableIcon } from "@/components/table/TableIcon";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@tabdo/ui/components/select";
import { Button } from "@tabdo/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@tabdo/ui/components/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@tabdo/ui/components/command";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@tabdo/ui/components/field";
import { DataRefreshButton } from "@/components/controls/data-refresh-button";
import { api, type MemberOption } from "@/lib/api";
import type { AppOutletContext } from "@/layouts/AppShell";
import type { FullTable } from "@/types/table";
import type { AutomationRule, AutomationRun } from "@tabdo/shared";

export function AutomationDetailPage() {
  const { t } = useTranslation("automation");
  const { automationId } = useParams(), navigate = useNavigate(), [search] = useSearchParams();
  const sourceParam = search.get("source") ?? "";
  const { tables, tablesLoading, getTableRefreshToken } = useOutletContext<AppOutletContext>();
  const [rule, setRule] = useState<AutomationRule | null>(null), [tableId, setTableId] = useState(search.get("source") ?? "");
  const [sourceId, setSourceId] = useState(search.get("source") ?? "");
  const [step, setStep] = useState<"source" | "configure">(search.get("source") ? "configure" : "source");
  const [table, setTable] = useState<FullTable | null>(null), [members, setMembers] = useState<MemberOption[]>([]);
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(Boolean(automationId));
  const [sourceError, setSourceError] = useState<string | null>(null), [sourceLoading, setSourceLoading] = useState(false);
  const [sourceRetry, setSourceRetry] = useState(0), [saving, setSaving] = useState(false);
  const [runs, setRuns] = useState<AutomationRun[] | null>(null);
  const previousRoute = useRef({ automationId, sourceParam });
  const refreshToken = getTableRefreshToken(tableId);
  useEffect(() => {
    const previous = previousRoute.current;
    previousRoute.current = { automationId, sourceParam };
    if (automationId || (previous.automationId === automationId && previous.sourceParam === sourceParam)) return;
    setTableId(sourceParam); setSourceId(sourceParam); setStep(sourceParam ? "configure" : "source");
  }, [automationId, sourceParam]);
  useEffect(() => { let cancelled = false; setRule(null); setError(null); setRuns(null); if (!automationId) { setLoading(false); return; } setLoading(true);
    void api.getAutomation(automationId).then((rule) => { if (!cancelled) { setRule(rule); setTableId(rule.tableId); setError(null); } }).catch((error) => { if (!cancelled) setError(error.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [automationId]);
  useEffect(() => {
    let cancelled = false;
    // A metadata refresh must not unmount the editor and erase its local draft.
    setTable((previous) => previous?.id === tableId ? previous : null);
    setSourceError(null);
    if (!tableId) { setSourceLoading(false); return; }
    setSourceLoading(true);
    void Promise.all([api.getTable(tableId), api.listMembers()]).then(([table, result]) => {
      if (!cancelled) { setTable(table); setMembers(result.members); }
    }).catch((error) => { if (!cancelled) setSourceError(error instanceof Error ? error.message : t("loadFailed")); })
      .finally(() => { if (!cancelled) setSourceLoading(false); });
    return () => { cancelled = true; };
  }, [tableId, refreshToken, sourceRetry, t]);
  const loadRuns = async () => { try { setRuns(await api.listAutomationRuns(tableId, { automationId, limit: 30 })); setError(null); } catch (error) { setError(error instanceof Error ? error.message : t("loadFailed")); } };
  useEffect(() => { if (!runs || !automationId) return; const timer = window.setInterval(() => { if (!document.hidden) void loadRuns(); }, 5000); return () => window.clearInterval(timer); }, [automationId, tableId, runs !== null]);
  const selectedSource = tables.find((source) => source.id === sourceId);
  const configuredSource = table?.id === tableId ? table : tables.find((source) => source.id === tableId);
  const chooseSource = () => {
    if (!selectedSource || saving) return;
    if (sourceId === tableId && sourceError) setSourceRetry((previous) => previous + 1);
    setTableId(sourceId); setStep("configure");
  };
  return <AppPage header={<AppPageHeader page="automations" description={automationId ? rule?.name ?? t("editAutomation") : t("newAutomation")}><Button variant="ghost" size="sm" disabled={saving} onClick={() => navigate("/app/automations")}><ArrowLeft data-icon="inline-start" />{t("backToList")}</Button>{rule && <Button variant="outline" size="sm" onClick={() => void loadRuns()}><History data-icon="inline-start" />{t("runs")}</Button>}</AppPageHeader>}>
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    {loading ? <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p> : (!automationId || rule) && <>
      {!automationId && step === "source" && <Card className="mx-auto w-full max-w-xl" data-testid="automation-source-step">
        <CardHeader><CardDescription>{t("creationStep", { step: 1 })}</CardDescription><CardTitle>{t("pickSourceTable")}</CardTitle></CardHeader>
        <CardContent>
          {tablesLoading ? <p role="status" className="py-6 text-sm text-muted-foreground">{t("loading")}</p> : !tables.length ? <FieldGroup><Field><FieldDescription>{t("noAvailableSources")}</FieldDescription><Button asChild variant="outline" className="self-start"><Link to="/app/tables">{t("createTableFirst")}</Link></Button></Field></FieldGroup> : <FieldGroup><Field>
            <FieldLabel htmlFor="automation-source-search" className="sr-only">{t("searchSource")}</FieldLabel>
            <Command className="h-auto rounded-lg border" label={t("searchSource")}>
              <CommandInput id="automation-source-search" placeholder={t("searchSource")} />
              <CommandList className="max-h-72" aria-label={t("sourceTable")}>
                <CommandEmpty>{t("noMatchingSource")}</CommandEmpty>
                <CommandGroup>{tables.map((source) => <CommandItem key={source.id} value={source.id} keywords={[source.name, source.description ?? ""]} onSelect={() => setSourceId(source.id)} className="gap-3 py-3">
                  <TableIcon name={source.icon} />
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{source.name}</div>{source.description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{source.description}</p>}</div>
                  {sourceId === source.id && <><Check className="ml-auto" aria-hidden="true" /><span className="sr-only">{t("sourceSelected")}</span></>}
                </CommandItem>)}</CommandGroup>
              </CommandList>
            </Command>
            {tableId && <FieldDescription>{t("changeSourceHint")}</FieldDescription>}
          </Field></FieldGroup>}
        </CardContent>
        <CardFooter className="mt-4 justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-muted-foreground" aria-live="polite">{selectedSource ? t("selectedSource", { name: selectedSource.name }) : t("pickTriggerTable")}</p>
          <Button type="button" className="shrink-0" disabled={!selectedSource || saving} onClick={chooseSource}>{t("nextStep")}<ArrowRight data-icon="inline-end" /></Button>
        </CardFooter>
      </Card>}
      <div data-testid="automation-configuration-step" hidden={!automationId && step !== "configure"}>
        {automationId ? <FieldGroup className="mx-auto mb-5 w-full max-w-3xl"><Field><FieldLabel htmlFor="automation-source">{t("sourceTable")}</FieldLabel>
          <Select value={tableId} disabled><SelectTrigger id="automation-source"><SelectValue placeholder={t("pickTriggerTable")} /></SelectTrigger><SelectContent><SelectGroup>{tables.map((source) => <SelectItem key={source.id} value={source.id}>{source.name}</SelectItem>)}</SelectGroup></SelectContent></Select>
        </Field></FieldGroup> : <div className="mx-auto mb-4 flex w-full max-w-3xl flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3"><TableIcon name={configuredSource?.icon} className="size-5 shrink-0 text-muted-foreground" /><div className="min-w-0"><p className="text-xs text-muted-foreground">{t("creationStep", { step: 2 })} · {t("sourceTable")}</p><p className="truncate text-sm font-medium">{configuredSource?.name ?? t("readingSource")}</p></div></div>
          <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => { setSourceId(tableId); setStep("source"); }}><ArrowLeft data-icon="inline-start" />{t("backToSource")}</Button>
        </div>}
        {sourceError && <ListErrorState className="mx-auto mb-4 min-h-0 max-w-3xl flex-none py-4" title={t("sourceLoadFailed")} description={sourceError} onRetry={() => setSourceRetry((previous) => previous + 1)} />}
        {table && table.id === tableId ? <AutomationEditor key={`${table.id}:${rule?.id ?? "new"}`} tableId={table.id} columns={table.columns.filter((column) => !column.config.hidden)} members={members} initial={rule} onSavingChange={setSaving} onClose={() => navigate("/app/automations")} onSaved={() => navigate("/app/automations")} /> : sourceLoading ? <p role="status" className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{t("readingSource")}</p> : null}
      </div>
      {runs && <section className="mx-auto mt-6 w-full max-w-3xl rounded-xl border border-border p-4"><div className="mb-3 flex items-center justify-between"><h2 className="font-medium">{t("runs")}</h2><DataRefreshButton onRefresh={loadRuns} /></div>{!runs.length ? <p className="text-sm text-muted-foreground">{t("noRunRecords")}</p> : <ul className="flex flex-col gap-3">{runs.map((run) => <li key={run.id} className="text-sm"><div className="flex justify-between gap-2"><span>{t(`runStatus.${run.status}`)}</span><time className="text-xs text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</time></div>{run.error && <p className="mt-1 text-destructive">{run.error}</p>}{run.status === "failed" && run.eventId && <Button className="mt-2" variant="outline" size="sm" onClick={async () => { try { await api.replayAutomationRun(run.id); await loadRuns(); } catch (error) { setError(error instanceof Error ? error.message : t("replayFailed")); } }}>{t("replayPending")}</Button>}</li>)}</ul>}</section>}
    </>}
  </AppPage>;
}
