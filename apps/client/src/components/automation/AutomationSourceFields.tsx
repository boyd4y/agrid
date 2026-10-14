import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import type { AutomationSource, IntegrationConnection, IntegrationInbox, WebhookEndpoint } from "@tabdo/shared";
import { ToggleGroup, ToggleGroupItem } from "@tabdo/ui/components/toggle-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@tabdo/ui/components/select";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@tabdo/ui/components/field";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { TableIcon } from "@/components/table/TableIcon";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { api } from "@/lib/api";
import type { AppOutletContext } from "@/layouts/AppShell";
import { ScheduleFields } from "./ScheduleFields";
import { AUTOMATION_SOURCE_ICONS } from "./automation-sources";

export function validAutomationSource(source: AutomationSource) {
  return source.kind === "table" ? Boolean(source.tableId) : source.kind === "agentmail" ? Boolean(source.connectionId && source.inboxId) : source.kind === "webhook" ? Boolean(source.endpointId) : Boolean(source.cron.trim() && source.timeZone.trim());
}

type Choice = { id: string; name: string; description?: string | null; icon?: string | null };
function SourceList({ label, choices, value, onChange, kind, disabled, search, empty }: {
  label: string; choices: Choice[]; value: string; onChange: (id: string) => void; kind: AutomationSource["kind"]; disabled?: boolean; search?: boolean; empty: React.ReactNode;
}) {
  const { t } = useTranslation("automation");
  const [query, setQuery] = useState("");
  const filtered = choices.filter(choice => `${choice.name} ${choice.description ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const Icon = AUTOMATION_SOURCE_ICONS[kind];
  return <Field className="min-h-0 min-w-0 gap-3"><FieldLabel>{label}</FieldLabel>
    {choices.length ? <>
      {search && <Input aria-label={t("searchSource")} placeholder={t("searchSource")} value={query} onChange={event => setQuery(event.target.value)} disabled={disabled} />}
      <ToggleGroup type="single" orientation="vertical" aria-label={label} value={value} disabled={disabled} variant="outline" onValueChange={id => { if (id) onChange(id); }} className="max-h-64 min-h-0 flex-col items-stretch justify-start gap-2 overflow-y-auto p-1">
        {filtered.map(choice => <ToggleGroupItem key={choice.id} value={choice.id} aria-label={choice.name} className="h-auto min-h-14 w-full justify-start gap-3 whitespace-normal px-3 py-3">
          {kind === "table" ? <TableIcon name={choice.icon} /> : <Icon aria-hidden />}
          <span className="flex min-w-0 flex-1 flex-col gap-1 text-left"><span className="truncate">{choice.name}</span>{choice.description && <FieldDescription className="line-clamp-2">{choice.description}</FieldDescription>}</span>
          {value === choice.id && <Check aria-label={t("sourceSelected")} />}
        </ToggleGroupItem>)}
      </ToggleGroup>
      {!filtered.length && <FieldDescription role="status">{t("noMatchingSource")}</FieldDescription>}
    </> : empty}
  </Field>;
}

export function AutomationSourceFields({ value, onChange, disabled, lockKind }: { value: AutomationSource; onChange: (source: AutomationSource) => void; disabled?: boolean; lockKind?: boolean }) {
  const { t } = useTranslation("automation"), { tables, tablesLoading } = useOutletContext<AppOutletContext>();
  const [connections, setConnections] = useState<IntegrationConnection[]>([]), [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]), [inboxes, setInboxes] = useState<IntegrationInbox[]>([]);
  const [error, setError] = useState<string | null>(null), [inboxError, setInboxError] = useState<string | null>(null), [loading, setLoading] = useState(false), [inboxesLoading, setInboxesLoading] = useState(false), [retry, setRetry] = useState(0);
  const connectionId = value.kind === "agentmail" ? value.connectionId : "";
  useEffect(() => {
    let cancelled = false; setError(null);
    if (value.kind !== "agentmail" && value.kind !== "webhook") { setLoading(false); return; }
    setLoading(true);
    void (value.kind === "agentmail" ? api.listIntegrations().then(result => { if (!cancelled) setConnections(result.connections); }) : api.listWebhookEndpoints().then(result => { if (!cancelled) setEndpoints(result.endpoints); }))
      .catch(error => { if (!cancelled) setError(error.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [value.kind, retry]);
  useEffect(() => {
    let cancelled = false; setInboxes([]); setInboxError(null);
    if (!connectionId) { setInboxesLoading(false); return; }
    setInboxesLoading(true);
    void api.listIntegrationInboxes(connectionId).then(result => { if (!cancelled) setInboxes(result.inboxes); })
      .catch(error => { if (!cancelled) setInboxError(error.message); }).finally(() => { if (!cancelled) setInboxesLoading(false); });
    return () => { cancelled = true; };
  }, [connectionId, retry]);
  const empty = (kind: "table" | "agentmail" | "webhook" | "inbox") => <AppEmptyState density="compact" illustration={NOTIOLY.chill} title={t(`sourceEmpty.${kind}.title`)} description={t(`sourceEmpty.${kind}.description`)} action={kind !== "inbox" && <Button asChild variant="outline" size="sm"><Link to={kind === "table" ? "/app/tables" : `/app/settings?tab=${kind}`}>{t(`sourceEmpty.${kind}.action`)}</Link></Button>} />;
  const status = <p role="status" className="py-6 text-sm text-muted-foreground">{t("loading")}</p>;
  const failure = (message: string) => <ListErrorState className="min-h-0 py-6" description={message} onRetry={() => setRetry(value => value + 1)} />;
  const availableConnections = connections.filter(connection => connection.enabled || connection.id === connectionId);
  const availableEndpoints = endpoints.filter(endpoint => endpoint.kind === "webhook" && (endpoint.enabled || value.kind === "webhook" && endpoint.id === value.endpointId));
  if (lockKind && value.kind === "table") return <Field><FieldLabel>{t("sourceTable")}</FieldLabel><Select value={value.tableId} disabled><SelectTrigger id="automation-source" aria-label={t("sourceTable")}><SelectValue placeholder={t("pickSourceTable")} /></SelectTrigger><SelectContent><SelectGroup>{tables.map(table => <SelectItem key={table.id} value={table.id}>{table.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>;
  return <FieldGroup className="gap-6">
    {value.kind !== "schedule" && !lockKind && <Field><FieldLabel>{t("generic.source")}</FieldLabel><ToggleGroup type="single" value={value.kind} disabled={disabled} variant="outline" aria-label={t("generic.source")} onValueChange={kind => {
      if (kind === "table") onChange({ kind, tableId: "" });
      else if (kind === "agentmail") onChange({ kind, connectionId: "", inboxId: "" });
      else if (kind === "webhook") onChange({ kind, endpointId: "" });
    }} className="grid grid-cols-2 gap-2">{(["table", "agentmail"] as const).map(kind => { const Icon = AUTOMATION_SOURCE_ICONS[kind]; return <ToggleGroupItem key={kind} value={kind} aria-label={t(`generic.sources.${kind}`)}><Icon aria-hidden />{t(`generic.sources.${kind}`)}</ToggleGroupItem>; })}</ToggleGroup></Field>}
    <div data-testid="automation-source-options" className={lockKind || value.kind === "schedule" ? "" : "min-h-[360px]"}>
      {value.kind === "table" && (tablesLoading ? status : <SourceList search label={t("sourceTable")} kind="table" choices={tables} value={value.tableId} onChange={tableId => onChange({ kind: "table", tableId })} disabled={disabled} empty={empty("table")} />)}
      {value.kind === "agentmail" && (loading ? status : error ? failure(error) : !availableConnections.length ? empty("agentmail") : <div className="grid min-w-0 gap-6 sm:grid-cols-2">
        <SourceList label={t("generic.connection")} kind="agentmail" choices={availableConnections.map(connection => ({ ...connection, description: !connection.enabled ? t("common:disabled") : undefined }))} value={value.connectionId} onChange={connectionId => onChange({ ...value, connectionId, inboxId: "" })} disabled={disabled} empty={empty("agentmail")} />
        {connectionId ? inboxesLoading ? status : inboxError ? failure(inboxError) : <SourceList label={t("generic.inbox")} kind="agentmail" choices={inboxes.map(inbox => ({ id: inbox.inboxId, name: inbox.displayName || inbox.address, description: inbox.displayName ? inbox.address : undefined }))} value={value.inboxId} onChange={inboxId => onChange({ ...value, inboxId })} disabled={disabled} empty={empty("inbox")} /> : <Field><FieldLabel>{t("generic.inbox")}</FieldLabel><FieldDescription>{t("sourceEmpty.pickConnection")}</FieldDescription></Field>}
      </div>)}
      {value.kind === "webhook" && (loading ? status : error ? failure(error) : <SourceList label={t("generic.endpoint")} kind="webhook" choices={availableEndpoints.map(endpoint => ({ ...endpoint, description: endpoint.receiveUrl }))} value={value.endpointId} onChange={endpointId => onChange({ ...value, endpointId })} disabled={disabled} empty={empty("webhook")} />)}
      {value.kind === "schedule" && <ScheduleFields disabled={disabled} value={value} onChange={onChange} />}
    </div>
  </FieldGroup>;
}
