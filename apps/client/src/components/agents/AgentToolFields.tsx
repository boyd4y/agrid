import { useEffect, useState } from "react";
import { ChevronRight, Wrench, Loader2, RefreshCw, Table2, ClipboardList, ChartColumn, Zap } from "lucide-react";
import type { AgentToolCatalogItem } from "@tabdo/shared";
import { api } from "@/lib/api";
import type { HarnessId } from "@/lib/harness";
import { Field, FieldGroup, FieldContent, FieldLabel, FieldDescription, FieldError, FieldSet, FieldLegend } from "@tabdo/ui/components/field";
import { Input } from "@tabdo/ui/components/input";
import { Switch } from "@tabdo/ui/components/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@tabdo/ui/components/collapsible";
import { Button } from "@tabdo/ui/components/button";
import { Badge } from "@tabdo/ui/components/badge";
import { useTranslation } from "react-i18next";
import { groupAgentTools, setAgentToolGroup } from "./tool-groups";

const capabilityIcons: Record<string, typeof Wrench> = {
  tables: Table2, forms: ClipboardList, reports: ChartColumn, automations: Zap,
  other: Wrench,
};

export function AgentToolFields({ harness, disabledTools, onChange, disabled }: {
  harness: HarnessId;
  disabledTools: string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("agents");
  const [catalog, setCatalog] = useState<AgentToolCatalogItem[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(""), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setCatalog([]); setError(null);
    void api.getAgentTools(harness, controller.signal).then(result => {
      if (!controller.signal.aborted) setCatalog(result.tools);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("toolsLoadFailed"));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [harness, retry, t]);
  const query = search.trim().toLowerCase();
  const groups = groupAgentTools(catalog).filter(group => `${t(`capabilities.${group.category}.name`)} ${t(`capabilities.${group.category}.description`)} ${group.tools.map(tool => `${tool.name} ${tool.id}`).join(" ")}`.toLowerCase().includes(query));
  return <FieldGroup className="gap-4" data-testid="agent-tool-fields">
    <Field className="gap-2">
      <FieldLabel htmlFor="agent-tool-search">{t("searchTools")}</FieldLabel>
      <Input size="sm" id="agent-tool-search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t("searchToolsPlaceholder")} disabled={disabled || loading} />
    </Field>
    {loading ? <FieldDescription role="status" className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />{t("loadingTools")}</FieldDescription>
      : error ? <Field className="gap-2"><FieldError>{error}</FieldError><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setRetry(value => value + 1)}><RefreshCw data-icon="inline-start" />{t("retry")}</Button></Field>
      : groups.length === 0 ? <FieldDescription>{t("noMatchingTools")}</FieldDescription>
      : <FieldSet className="gap-0" data-tool-source="platform">
          <FieldLegend variant="label" className="flex items-center gap-2"><Wrench className="size-4" />{t("platformTools")}</FieldLegend>
          <FieldGroup className="gap-0 divide-y divide-border">
            {groups.map(group => {
              const Icon = capabilityIcons[group.category] ?? Wrench;
              const enabledCount = group.tools.filter(tool => !disabledTools.includes(tool.id)).length;
              const mixed = enabledCount > 0 && enabledCount < group.tools.length;
              const canToggle = group.tools.some(tool => !tool.alwaysEnabled);
              return <div key={group.id} className="flex flex-col gap-2 py-3" data-tool-group={group.id} data-mixed={mixed}>
                <Field orientation="horizontal" className="items-center gap-3">
                  <FieldContent className="min-w-0">
                    <FieldLabel className="flex-wrap" htmlFor={`agent-group-${group.id}`}><Icon className="size-4 shrink-0" aria-hidden />{t(`capabilities.${group.category}.name`)}{mixed && <Badge variant="secondary">{t("partlyEnabled")}</Badge>}</FieldLabel>
                    <FieldDescription id={`agent-group-description-${group.id}`}>{t(`capabilities.${group.category}.description`)}</FieldDescription>
                  </FieldContent>
                  <Switch size="sm" id={`agent-group-${group.id}`} aria-label={t(`capabilities.${group.category}.name`)} aria-describedby={`agent-group-description-${group.id}`} checked={enabledCount === group.tools.length} disabled={disabled || !canToggle} onCheckedChange={checked => onChange(setAgentToolGroup(disabledTools, group.tools, checked))} />
                </Field>
                <Collapsible className="min-w-0" key={query ? "search" : "browse"} defaultOpen={Boolean(query)}>
                  <CollapsibleTrigger asChild><Button type="button" variant="ghost" size="sm" className="max-w-full justify-start"><ChevronRight data-icon="inline-start" /><span className="truncate">{t("enabledCount", { enabled: enabledCount, total: group.tools.length })} · {t("toolDetails")}</span></Button></CollapsibleTrigger><CollapsibleContent>
                  <ul className="mt-2 grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-2">
                    {group.tools.map(tool => <li key={tool.id} data-tool-id={tool.id} className="min-w-0 break-all text-xs text-muted-foreground"><code>{tool.name}</code>{disabledTools.includes(tool.id) && <span className="ml-1">· {t("toolOff")}</span>}</li>)}
                  </ul>
                </CollapsibleContent></Collapsible>
              </div>;
            })}
          </FieldGroup>
        </FieldSet>}
  </FieldGroup>;
}
