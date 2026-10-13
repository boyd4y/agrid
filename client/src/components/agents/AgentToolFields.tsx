import { useEffect, useState } from "react";
import { Cpu, Wrench, Search, Loader2, RefreshCw } from "lucide-react";
import type { AgentToolCatalogItem } from "@tabdo/shared";
import { api } from "@/lib/api";
import type { HarnessId } from "@/lib/harness";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldContent, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

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
  const [supportsFiltering, setSupportsFiltering] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setCatalog([]); setError(null); setSupportsFiltering(false);
    void api.getAgentTools(harness, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setCatalog(result.tools); setSupportsFiltering(result.supportsFiltering); }
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("toolsLoadFailed"));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [harness, retry, t]);
  const filtered = catalog.filter((tool) => `${tool.name} ${tool.id} ${tool.description} ${tool.group}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <FieldGroup data-testid="agent-tool-fields">
    <Field>
      <FieldLabel htmlFor="agent-tool-search"><Search className="size-4" />{t("searchTools")}</FieldLabel>
      <Input id="agent-tool-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchToolsPlaceholder")} disabled={disabled || loading} />
      <FieldDescription>{t("toolsHint")}</FieldDescription>
    </Field>
    {loading ? <FieldDescription role="status" className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />{t("loadingTools")}</FieldDescription>
      : error ? <Field><FieldError>{error}</FieldError><Button type="button" variant="outline" disabled={disabled} onClick={() => setRetry((value) => value + 1)}><RefreshCw data-icon="inline-start" />{t("retry")}</Button></Field>
      : filtered.length === 0 ? <FieldDescription>{t("noMatchingTools")}</FieldDescription>
      : <div className="flex max-h-[min(65vh,42rem)] flex-col gap-4 overflow-y-auto p-1">{(["builtin", "platform"] as const).map((source) => {
        const tools = filtered.filter((tool) => tool.source === source);
        if (!tools.length) return null;
        const enabled = tools.filter((tool) => !disabledTools.includes(tool.id)).length;
        return <Card key={source} padding="sm" data-tool-source={source}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">{source === "builtin" ? <Cpu className="size-4" /> : <Wrench className="size-4" />}{source === "builtin" ? t("harnessBuiltin") : t("platformTools")}<span className="ml-auto text-xs font-normal text-muted-foreground">{t("enabledCount", { enabled, total: tools.length })}</span></CardTitle>
            <CardDescription>{source === "builtin" ? t("builtinDesc") : t("workspaceDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="gap-0 divide-y divide-border">
              {tools.map((tool) => <Field key={tool.id} orientation="horizontal" className="items-center py-3" data-tool-id={tool.id}>
                <FieldContent>
                  <FieldLabel htmlFor={`agent-tool-${tool.id}`}>{tool.name}{tool.name !== tool.id && <span className="truncate font-mono text-xs font-normal text-muted-foreground">{tool.id}</span>}</FieldLabel>
                  <FieldDescription className="line-clamp-2" title={tool.description}>{tool.description}</FieldDescription>
                </FieldContent>
                <Switch id={`agent-tool-${tool.id}`} aria-label={tool.name} checked={!disabledTools.includes(tool.id)} disabled={disabled || !supportsFiltering || tool.alwaysEnabled} onCheckedChange={(checked) => onChange(checked ? disabledTools.filter((name) => name !== tool.id) : [...new Set([...disabledTools, tool.id])].sort())} />
              </Field>)}
            </FieldGroup>
          </CardContent>
        </Card>;
      })}</div>}
  </FieldGroup>;
}
