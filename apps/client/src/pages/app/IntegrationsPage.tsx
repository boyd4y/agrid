import { ConnectionEndpoints } from "@/components/automation/ConnectionEndpoints";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Mail, Plus, Save, Trash2, Webhook, X } from "lucide-react";
import type { IntegrationConnection, IntegrationInbox, WebhookEndpoint } from "@tabdo/shared";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { DataRefreshButton } from "@/components/controls/data-refresh-button";
import { ListPagination } from "@/components/controls/list-pagination";
import { DeleteConfirmation } from "@/components/controls/delete-confirmation";
import { useArrayPagination } from "@/hooks/useListPagination";
import { api } from "@/lib/api";
import { Button } from "@tabdo/ui/components/button";
import { Badge } from "@tabdo/ui/components/badge";
import { ListItem } from "@tabdo/ui/components/list-item";
import { CardDescription, CardTitle } from "@tabdo/ui/components/card";
import { Input } from "@tabdo/ui/components/input";
import { Switch } from "@tabdo/ui/components/switch";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@tabdo/ui/components/field";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/controls/dialog";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { Skeleton } from "@tabdo/ui/components/skeleton";
import { IntegrationCreateDialog } from "@/components/automation/IntegrationCreateDialog";
import { IntegrationCredentialsFields, IntegrationInboxSelection } from "@/components/automation/IntegrationFields";
import { toast } from "sonner";

type Editor = { kind: "agentmail"; connection: IntegrationConnection } | { kind: "webhook"; endpoint: WebhookEndpoint };
export function IntegrationsPage({ kind }: { kind: "agentmail" | "webhook" }) {
  const { t } = useTranslation("integrations");
  const [connections, setConnections] = useState<IntegrationConnection[]>([]), [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]), [canManage, setCanManage] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(0), [editor, setEditor] = useState<Editor | null>(null), [deleting, setDeleting] = useState<Editor | null>(null), [creating, setCreating] = useState<"agentmail" | "webhook" | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      if (kind === "agentmail") {
        const result = await api.listIntegrations();
        if (!cancelled) { setConnections(result.connections); setCanManage(result.canManage); }
      } else {
        const result = await api.listWebhookEndpoints();
        if (!cancelled) { setEndpoints(result.endpoints.filter(endpoint => endpoint.kind === "webhook")); setCanManage(result.canManage); }
      }
      if (!cancelled) setError(null);
    };
    void load().catch(error => { if (!cancelled) setError(error.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, retry]);
  const items: Editor[] = kind === "agentmail" ? connections.map(connection => ({ kind: "agentmail", connection })) : endpoints.map(endpoint => ({ kind: "webhook", endpoint }));
  const pagination = useArrayPagination(items);
  useEffect(() => pagination.resetPage(), [kind, pagination.resetPage]);
  const refresh = () => setRetry(value => value + 1);
  const create = canManage ? <Button size="sm" onClick={() => setCreating(kind)}><Plus data-icon="inline-start" />{t(kind === "agentmail" ? "newMail" : "newWebhook")}</Button> : undefined;
  const remove = async () => { if (!deleting) return; if (deleting.kind === "agentmail") await api.deleteIntegration(deleting.connection.id); else await api.deleteWebhookEndpoint(deleting.endpoint.id); setDeleting(null); refresh(); };
  const content = <>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {kind === "agentmail" && <CardTitle>AgentMail</CardTitle>}
        <CardDescription>{t(kind === "agentmail" ? "mailPurpose" : "webhookPurpose")}</CardDescription>
        {!loading && !error && items.length > 0 && <p className="text-xs text-muted-foreground">{t("count", { count: items.length })}</p>}
      </div>
      <div data-testid="integrations-toolbar" className="flex items-center gap-2"><DataRefreshButton disabled={loading} onRefresh={refresh} />{items.length > 0 && create}</div>
    </header>
    {loading ? <div role="status" aria-label={t("loading")} className="flex flex-col gap-3">{[0, 1, 2].map(id => <Skeleton key={id} className="h-24 w-full" />)}</div>
      : error ? <ListErrorState title={t("loadFailed")} description={error} onRetry={refresh} />
      : !items.length ? <AppEmptyState data-testid="integrations-empty" density="compact" className="px-2 sm:px-6" illustration={NOTIOLY.fastInternet} title={t(kind === "agentmail" ? "mailEmptyTitle" : "webhookEmptyTitle")} description={t(canManage ? kind === "agentmail" ? "mailEmptyHint" : "webhookEmptyHint" : "askAdmin")} action={create} />
      : <><ul className="flex flex-col gap-3">{pagination.items.map(item => { const metadata = item.kind === "agentmail" ? item.connection : item.endpoint, Icon = item.kind === "agentmail" ? Mail : Webhook; return <ListItem key={metadata.id} className="flex items-start gap-4"><button type="button" className="absolute inset-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={metadata.name} onClick={() => setEditor(item)} /><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted"><Icon className="size-5 text-muted-foreground" /></span><div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-2"><h2 className="truncate font-medium">{metadata.name}</h2><p className="text-sm text-muted-foreground">{t(item.kind === "agentmail" ? "mailPurpose" : "webhookPurpose")}</p>{metadata.lastError && <p className="truncate text-sm text-destructive">{metadata.lastError}</p>}<div><Badge variant="outline">{metadata.enabled ? t("states." + metadata.state) : t("disabled")}</Badge></div></div>{canManage && <Button className="relative" variant="destructive-ghost" size="icon" aria-label={t("deleteNamed", { name: metadata.name })} onClick={() => setDeleting(item)}><Trash2 data-icon="inline-start" /></Button>}</ListItem>; })}</ul><ListPagination page={pagination.page} hasNext={pagination.hasNext} totalPages={pagination.totalPages} onPageChange={pagination.setPage} /></>}
    {creating && <IntegrationCreateDialog kind={creating} onClose={() => setCreating(null)} onSaved={refresh} />}
    <Dialog open={Boolean(editor)} onOpenChange={open => { if (!open) setEditor(null); }}><DialogContent data-testid="integration-edit-dialog" className="flex max-h-[calc(100dvh-2rem)] max-w-xl flex-col gap-0 overflow-hidden p-0"><DialogHeader className="shrink-0 border-b p-6 pr-12"><DialogTitle>{editor?.kind === "agentmail" ? t("connection") : t("endpoint")}</DialogTitle><DialogDescription>{editor?.kind === "agentmail" ? t("connectionHint") : t("endpointHint")}</DialogDescription></DialogHeader>{editor && <IntegrationEditor key={editor.kind === "agentmail" ? editor.connection.id : editor.endpoint.id} editor={editor} canManage={canManage} onSaved={refresh} onClose={() => setEditor(null)} />}</DialogContent></Dialog>
    <DeleteConfirmation open={Boolean(deleting)} onOpenChange={open => { if (!open) setDeleting(null); }} title={t("deleteTitle")} description={t("deleteDescription")} onConfirm={remove} />
  </>;
  return <div className="flex min-w-0 flex-col gap-6" data-testid="integrations-settings">{content}</div>;
}

function IntegrationEditor({ editor, canManage, onSaved, onClose }: { editor: Editor; canManage: boolean; onSaved: () => void; onClose: () => void }) {
  const { t } = useTranslation("integrations"), initial = editor.kind === "agentmail" ? editor.connection : editor.endpoint;
  const [metadata, setMetadata] = useState(initial), [name, setName] = useState(initial.name), [apiKey, setApiKey] = useState(""), [enabled, setEnabled] = useState(initial.enabled), [inboxes, setInboxes] = useState<IntegrationInbox[] | null>(null), [inboxIds, setInboxIds] = useState<string[]>([]), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [endpointRefresh, setEndpointRefresh] = useState(0);
  const alive = useRef(true), pending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const action = async (perform: () => Promise<void>) => { if (pending.current) return; pending.current = true; setBusy(true); setError(null); try { await perform(); } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : t("saveFailed")); } finally { pending.current = false; if (alive.current) setBusy(false); } };
  const save = () => action(async () => {
    if (editor.kind === "agentmail") { const result = await api.updateIntegration(metadata.id, { name, ...(enabled !== metadata.enabled ? { enabled } : {}), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }); if (alive.current) { setMetadata(result.connection); setApiKey(""); } }
    else { const result = await api.updateWebhookEndpoint(metadata.id, { name, ...(enabled !== metadata.enabled ? { enabled } : {}) }); if (alive.current) setMetadata(result.endpoint); }
    onSaved(); if (alive.current) toast.success(t("saved"));
  });
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success(t("copied")); } catch { toast.error(t("copyFailed")); } };
  const receiveUrl = "receiveUrl" in metadata ? metadata.receiveUrl : "";
  return <><div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6"><IntegrationCredentialsFields name={name} onName={setName} apiKey={apiKey} onApiKey={editor.kind === "agentmail" && canManage ? setApiKey : undefined} stored disabled={!canManage || busy} />
    <Field orientation="horizontal"><FieldLabel htmlFor="integration-enabled">{t("enabled")}</FieldLabel><Switch id="integration-enabled" checked={enabled} disabled={!canManage || busy} onCheckedChange={setEnabled} /></Field>
    {receiveUrl && <Field><FieldLabel>{t("receiveUrl")}</FieldLabel><Input readOnly value={receiveUrl} aria-label={t("receiveUrl")} /><Button type="button" variant="outline" size="sm" className="self-start" onClick={() => void copy(receiveUrl)}><Copy data-icon="inline-start" />{t("copyUrl")}</Button></Field>}
    {editor.kind === "agentmail" && canManage && <FieldGroup><Field><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void action(async () => { const result = await api.testIntegration(metadata.id); if (alive.current) { setMetadata(result.connection); if (!result.ok) setError(result.connection.lastError ?? t("testFailed")); else toast.success(t("testPassed")); } onSaved(); })}>{t("testConnection")}</Button><Button variant="outline" disabled={busy} onClick={() => void action(async () => { const result = await api.listIntegrationInboxes(metadata.id); if (alive.current) setInboxes(result.inboxes); })}>{t("loadInboxes")}</Button></div></Field>{inboxes && <><IntegrationInboxSelection inboxes={inboxes} selected={inboxIds} onChange={setInboxIds} disabled={busy} /><Button variant="outline" className="self-start" disabled={busy || !inboxIds.length} onClick={() => void action(async () => { await api.registerIntegrationWebhook(metadata.id, inboxIds); if (alive.current) setEndpointRefresh(value => value + 1); onSaved(); })}>{t("registerWebhook")}</Button></>}</FieldGroup>}
    {editor.kind === "agentmail" && <ConnectionEndpoints connectionId={metadata.id} canManage={canManage} refreshToken={endpointRefresh} />}
    {error && <FieldDescription role="alert">{error}</FieldDescription>}
  </div><div className="flex shrink-0 items-center justify-end gap-2 border-t p-4"><Button type="button" variant="outline" disabled={busy} onClick={onClose}><X data-icon="inline-start" />{t("common:cancel")}</Button>{canManage && <Button type="button" disabled={busy || !name.trim()} onClick={save}><Save data-icon="inline-start" />{busy ? t("saving") : t("save")}</Button>}</div></>;
}
