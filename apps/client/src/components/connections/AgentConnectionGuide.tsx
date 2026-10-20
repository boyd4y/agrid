import { useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@tabdo/ui/components/button";
import { CardDescription, CardTitle } from "@tabdo/ui/components/card";
import { ToggleGroup, ToggleGroupItem } from "@tabdo/ui/components/toggle-group";
import { connectionClient, connectionClients, connectionRecipe, connectionSources } from "@/components/connections/connection-guide";

export function AgentConnectionGuide({ publicMode = false }: { publicMode?: boolean }) {
  const { t } = useTranslation("app");
  const text = (key: string) => t(`settings.connections.${key}`);
  const [params, setParams] = useSearchParams();
  const client = connectionClient(params.get("client"));
  const recipe = connectionRecipe(client, window.location.origin);
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); toast.success(text("copied")); }
    catch { toast.error(text("copyFailed")); }
  }

  return <section className="flex min-w-0 flex-col gap-5" data-testid="agent-connection-guide">
    <header className="flex flex-col gap-2">
      <CardTitle>{t("settings.tabs.connections")}</CardTitle>
      <CardDescription>{text("description")}</CardDescription>
    </header>
    <ToggleGroup type="single" variant="outline" size="sm" value={client} aria-label={text("clientLabel")} className="flex-wrap justify-start gap-2" onValueChange={value => {
      if (!value) return;
      setParams(current => { const next = new URLSearchParams(current); next.set("client", value); return next; });
    }}>
      {connectionClients.map(value => <ToggleGroupItem key={value} value={value}>{text(`clients.${value}.name`)}</ToggleGroupItem>)}
    </ToggleGroup>
    <ol className="flex min-w-0 list-decimal flex-col gap-5 pl-5 text-sm marker:text-muted-foreground">
      <li className="pl-1">
        <div className="flex flex-col items-start gap-2">
          <h3 className="font-medium">{text("prepareTitle")}</h3>
          <p className="max-w-prose leading-relaxed text-muted-foreground">{text("prepare")}</p>
          <Button asChild variant="outline" size="sm"><Link to={publicMode ? "/app/settings?tab=connections" : "/app/settings?tab=api-keys"}>{text(publicMode ? "openWorkspace" : "manageKeys")}</Link></Button>
        </div>
      </li>
      <li className="min-w-0 pl-1">
        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="font-medium">{text(`clients.${client}.setupTitle`)}</h3>
          <p className="max-w-prose leading-relaxed text-muted-foreground">{text(`clients.${client}.setup`)}</p>
          <div className="min-w-0 overflow-hidden rounded-md border bg-muted/40" data-testid="connection-recipe">
            {recipe.code !== null ? <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
                <span className="text-xs text-muted-foreground">{text(client === "cursor" ? "configuration" : "command")}</span>
                <Button variant="outline" size="sm" onClick={() => void copy(recipe.code!)}><Copy data-icon="inline-start" />{text("copyExample")}</Button>
              </div>
              <pre className="overflow-x-auto p-4 text-xs leading-relaxed"><code>{recipe.code}</code></pre>
            </> : <dl className="flex min-w-0 flex-col divide-y">
              {recipe.fields.map(field => <div key={field.label} className="flex min-w-0 items-center gap-3 px-3 py-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">{text(field.label)}</dt>
                  <dd className="break-all font-mono text-xs leading-relaxed">{field.value}</dd>
                </div>
                <Button variant="outline" size="icon" aria-label={t("settings.connections.copyField", { field: text(field.label) })} onClick={() => void copy(field.value)}><Copy data-icon="inline-start" /></Button>
              </div>)}
            </dl>}
          </div>
          <p className="max-w-prose leading-relaxed text-muted-foreground">{text(`clients.${client}.note`)}</p>
        </div>
      </li>
      <li className="pl-1">
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">{text("verifyTitle")}</h3>
          <p className="max-w-prose leading-relaxed text-muted-foreground">{text(`clients.${client}.verify`)}</p>
        </div>
      </li>
    </ol>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
      <p className="text-xs text-muted-foreground">{text("notChecked")}</p>
      <Button asChild variant="ghost" size="sm"><a href={connectionSources[client]} target="_blank" rel="noreferrer">{text("reference")}<ExternalLink data-icon="inline-end" /></a></Button>
    </div>
  </section>;
}
