import { useEffect, useState } from "react";
import { useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { AutomationRule, AutomationSource } from "@tabdo/shared";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { AutomationEditor } from "@/components/automation/AutomationPanel";
import { AutomationSourceFields, validAutomationSource } from "@/components/automation/AutomationSourceFields";
import { AUTOMATION_SOURCE_ICONS } from "@/components/automation/automation-sources";
import { AutomationRunsSheet } from "@/components/automation/AutomationRunsSheet";
import { Button } from "@tabdo/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@tabdo/ui/components/card";
import { api } from "@/lib/api";
import { useMemberOptions } from "@/hooks/useMemberOptions";
import type { AppOutletContext } from "@/layouts/AppShell";
import type { FullTable } from "@/types/table";

export function AutomationDetailPage() {
  const { t } = useTranslation("automation"), { automationId } = useParams(), navigate = useNavigate(), [search] = useSearchParams();
  const listPath = "/app/automations";
  const defaultSource: AutomationSource = { kind: "table", tableId: search.get("source") ?? "" };
  const sourceParam = search.get("source") ?? "", { tables, getTableRefreshToken } = useOutletContext<AppOutletContext>();
  const [source, setSource] = useState<AutomationSource>(defaultSource);
  const [configuredSource, setConfiguredSource] = useState<AutomationSource | null>(sourceParam ? { kind: "table", tableId: sourceParam } : null);
  const [rule, setRule] = useState<AutomationRule | null>(null), [table, setTable] = useState<FullTable | null>(null);
  const [step, setStep] = useState<"source" | "configure">(sourceParam ? "configure" : "source"), [loading, setLoading] = useState(Boolean(automationId)), [error, setError] = useState<string | null>(null), [sourceError, setSourceError] = useState<string | null>(null), [retry, setRetry] = useState(0), [saving, setSaving] = useState(false);
  const members = useMemberOptions();
  useEffect(() => { let cancelled = false; setError(null); setRule(null); if (!automationId) { const source = defaultSource; setSource(source); setConfiguredSource(sourceParam ? source : null); setStep(sourceParam ? "configure" : "source"); setLoading(false); return; } setLoading(true); void api.getAutomation(automationId).then(rule => { if (!cancelled) { setRule(rule); setSource(rule.source); setConfiguredSource(rule.source); } }).catch(error => { if (!cancelled) setError(error.message); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [automationId, sourceParam]);
  useEffect(() => { if (rule?.source.kind === "schedule") navigate(`/app/schedules/${rule.id}`, { replace: true }); }, [rule, navigate]);
  const tableId = configuredSource?.kind === "table" ? configuredSource.tableId : "", refreshToken = getTableRefreshToken(tableId);
  useEffect(() => { let cancelled = false; setTable(previous => previous?.id === tableId ? previous : null); setSourceError(null); if (!tableId) return; void api.getTable(tableId).then(table => { if (!cancelled) setTable(table); }).catch(error => { if (!cancelled) setSourceError(error.message); }); return () => { cancelled = true; }; }, [tableId, refreshToken, retry]);
  const sourceLabel = configuredSource?.kind === "table" ? table?.name ?? tables.find(table => table.id === tableId)?.name : configuredSource ? t(`generic.sources.${configuredSource.kind}`) : "";
  const SourceIcon = configuredSource ? AUTOMATION_SOURCE_ICONS[configuredSource.kind] : AUTOMATION_SOURCE_ICONS.table;
  return <AppPage header={<AppPageHeader page="automations" description={automationId ? rule?.name ?? t("editAutomation") : t("newAutomation")}><Button variant="ghost" size="sm" disabled={saving} onClick={() => navigate(listPath)}><ArrowLeft data-icon="inline-start" />{t("backToList")}</Button>{rule && <AutomationRunsSheet automationId={rule.id} name={rule.name} />}</AppPageHeader>}>
    {error && <ListErrorState title={t("loadFailed")} description={error} onRetry={() => navigate(0)} />}
    {loading ? <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p> : (!automationId || rule) && <>
      {!automationId && step === "source" && <Card padding="lg" className="mx-auto my-auto flex h-[640px] w-full max-w-2xl shrink-0 flex-col gap-6" data-testid="automation-source-step"><CardHeader className="mb-0"><CardDescription>{t("creationStep", { step: 1 })}</CardDescription><CardTitle>{t("generic.pickSource")}</CardTitle></CardHeader><CardContent className="min-h-0 flex-1 overflow-y-auto"><AutomationSourceFields value={source} onChange={setSource} disabled={saving} /></CardContent><CardFooter className="shrink-0 justify-end gap-4 pt-4"><Button type="button" disabled={!validAutomationSource(source) || saving} onClick={() => { setConfiguredSource(source); setStep("configure"); }}>{t("nextStep")}<ArrowRight data-icon="inline-end" /></Button></CardFooter></Card>}
      <div className="my-auto shrink-0" data-testid="automation-configuration-step" hidden={!automationId && step !== "configure"}>
        {configuredSource && <div className="mx-auto mb-4 flex w-full max-w-3xl items-center justify-between gap-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">{automationId ? t("generic.source") : t("creationStep", { step: 2 })}</p><p className="flex items-center gap-2 text-sm font-medium"><SourceIcon className="size-4 shrink-0" /><span className="truncate">{sourceLabel}</span></p></div>{!automationId && <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => setStep("source")}><ArrowLeft data-icon="inline-start" />{t("backToSource")}</Button>}</div>}
        {automationId && configuredSource?.kind === "table" && <div className="mx-auto mb-4 w-full max-w-3xl"><AutomationSourceFields value={configuredSource} onChange={() => {}} disabled lockKind /></div>}
        {sourceError && <ListErrorState className="mx-auto max-w-3xl" title={t("sourceLoadFailed")} description={sourceError} onRetry={() => setRetry(value => value + 1)} />}
        {configuredSource && (configuredSource.kind !== "table" || table?.id === tableId) ? <AutomationEditor key={`${automationId ?? "new"}:${JSON.stringify(configuredSource)}`} tableId={tableId} source={configuredSource} columns={table?.columns.filter(column => !column.config.hidden) ?? []} members={members} initial={rule} onSavingChange={setSaving} onClose={() => navigate(listPath)} onSaved={() => navigate(listPath)} /> : tableId && !sourceError ? <p role="status" className="py-6 text-center text-sm text-muted-foreground">{t("readingSource")}</p> : null}
      </div>
    </>}
  </AppPage>;
}
