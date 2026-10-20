import { useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@tabdo/ui/components/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@tabdo/ui/components/collapsible";
import { CardDescription, CardTitle } from "@tabdo/ui/components/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@tabdo/ui/components/tabs";
import { connectionClient, connectionClients, connectionRecipe, connectionSources } from "@/components/connections/connection-guide";

type Props = {
  publicMode?: boolean;
  canManageKeys?: boolean;
  secret?: string;
  onCreate?: (name: string) => void;
  createDisabled?: boolean;
  firstKey?: boolean;
};

export function AgentConnectionGuide({ publicMode = false, canManageKeys = true, secret, onCreate, createDisabled, firstKey }: Props) {
  const { t } = useTranslation("app");
  const text = (key: string) => t(`settings.connections.${key}`);
  const [params, setParams] = useSearchParams();
  const client = connectionClient(params.get("client"));
  // Public docs never consume credentials, even if a caller accidentally passes one.
  const activeSecret = publicMode ? undefined : secret;
  const recipe = connectionRecipe(client, window.location.origin, activeSecret);
  const complete = recipe.code ?? recipe.fields.map(field => `${text(field.label)}: ${field.value}`).join("\n");
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); toast.success(text("copied")); }
    catch { toast.error(text("copyFailed")); }
  }

  return <section className="flex min-w-0 flex-col gap-5" data-testid="agent-connection-guide">
    <header className="flex flex-col gap-2">
      <CardTitle>{publicMode ? text("guideTitle") : t("settings.tabs.connections")}</CardTitle>
      <CardDescription>{text("description")}</CardDescription>
    </header>
    {publicMode && <div className="flex flex-col items-start gap-3 text-sm">
      <p className="max-w-prose leading-relaxed text-muted-foreground">{text("prepare")}</p>
      <Button asChild variant="outline" size="sm"><Link to="/app/settings?tab=connections">{text("openWorkspace")}</Link></Button>
    </div>}
    <Tabs value={client} activationMode="manual" onValueChange={value => {
      setParams(current => { const next = new URLSearchParams(current); next.set("client", value); return next; });
    }} className="min-w-0 gap-5">
      <TabsList variant="line" aria-label={text("clientLabel")} className="h-auto justify-start border-b">
        {connectionClients.map(value => <TabsTrigger key={value} value={value} className="rounded-none py-3 data-[state=active]:text-primary group-data-[variant=line]/tabs-list:data-[state=active]:after:bg-primary">{text(`clients.${value}.name`)}</TabsTrigger>)}
      </TabsList>
      <TabsContent value={client} className="flex min-w-0 flex-col gap-3">
        <h3 className="text-base font-semibold">{t("settings.connections.addTo", { client: text(`clients.${client}.name`) })}</h3>
        {!publicMode && <div className="flex flex-wrap items-center gap-4">
          {canManageKeys && onCreate && <Button variant={activeSecret ? "outline" : "default"} disabled={createDisabled} onClick={() => onCreate(text(`clients.${client}.name`))}>{text(activeSecret ? "createAnother" : "createConfiguration")}</Button>}
          <p className="text-sm text-muted-foreground" role={activeSecret ? "status" : undefined}>{text(activeSecret ? "generated" : firstKey ? "firstKey" : "useTemplate")}</p>
        </div>}
        <div className="min-w-0 overflow-hidden rounded-md border bg-muted/40" data-testid="connection-recipe">
          <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
            <span className="text-xs font-medium">{text(recipe.code === null ? "fields" : client === "cursor" ? "configuration" : "command")}</span>
            <Button variant={activeSecret ? "default" : "outline"} size="sm" onClick={() => void copy(complete)}><Copy data-icon="inline-start" />{text(activeSecret ? "copyConfiguration" : "copyTemplate")}</Button>
          </div>
          {recipe.code !== null ? <pre className="overflow-x-auto p-4 text-xs leading-relaxed"><code>{recipe.code}</code></pre> : <dl className="flex min-w-0 flex-col divide-y">
            {recipe.fields.map(field => <div key={field.label} className="flex min-w-0 items-center gap-3 px-3 py-2">
              <div className="grid min-w-0 flex-1 grid-cols-[10rem_1fr] items-baseline gap-3">
                <dt className="text-xs text-muted-foreground">{text(field.label)}</dt>
                <dd className="break-all font-mono text-xs leading-relaxed">{field.value}</dd>
              </div>
              <Button variant="ghost" size="icon" aria-label={t("settings.connections.copyField", { field: text(field.label) })} onClick={() => void copy(field.value)}><Copy data-icon="inline-start" /></Button>
            </div>)}
          </dl>}
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{text(`clients.${client}.short`)}</p>
        <Collapsible key={client} className="text-sm">
          <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="px-0 text-primary">{text("details")}<ChevronDown data-icon="inline-end" /></Button></CollapsibleTrigger>
          <CollapsibleContent className="flex max-w-prose flex-col gap-3 pt-3 leading-relaxed text-muted-foreground">
            <p>{text(`clients.${client}.${activeSecret ? "setupGenerated" : "setup"}`)}</p>
            <p>{text(`clients.${client}.note`)}</p>
            <p>{text(`clients.${client}.verify`)}</p>
            <p>{text("notChecked")}</p>
            <Button asChild variant="ghost" size="sm" className="w-fit px-0"><a href={connectionSources[client]} target="_blank" rel="noreferrer">{text("reference")}<ExternalLink data-icon="inline-end" /></a></Button>
          </CollapsibleContent>
        </Collapsible>
      </TabsContent>
    </Tabs>
  </section>;
}
