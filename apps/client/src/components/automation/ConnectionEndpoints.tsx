import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Trash2 } from "lucide-react";
import type { WebhookEndpoint } from "@tabdo/shared";
import { Button } from "@tabdo/ui/components/button";
import { Badge } from "@tabdo/ui/components/badge";
import { ListItem } from "@tabdo/ui/components/list-item";
import { Input } from "@tabdo/ui/components/input";
import { Switch } from "@tabdo/ui/components/switch";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@tabdo/ui/components/field";
import { DeleteConfirmation } from "@/components/controls/delete-confirmation";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { api } from "@/lib/api";
import { toast } from "sonner";

export function ConnectionEndpoints({ connectionId, canManage, refreshToken }: { connectionId: string; canManage: boolean; refreshToken: number }) {
  const { t } = useTranslation("integrations");
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[] | null>(null), [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(0), [busy, setBusy] = useState<string | null>(null), [deleting, setDeleting] = useState<WebhookEndpoint | null>(null);
  useEffect(() => { let cancelled = false; void api.listWebhookEndpoints().then(result => { if (!cancelled) { setEndpoints(result.endpoints.filter(endpoint => endpoint.connectionId === connectionId)); setError(null); } }).catch(error => { if (!cancelled) setError(error.message); }); return () => { cancelled = true; }; }, [connectionId, retry, refreshToken]);
  const refresh = () => setRetry(value => value + 1);
  const change = async (endpoint: WebhookEndpoint, enabled: boolean) => { if (busy) return; setBusy(endpoint.id); setError(null); try { await api.updateWebhookEndpoint(endpoint.id, { enabled }); } catch (error) { setError(error instanceof Error ? error.message : t("saveFailed")); } finally { setBusy(null); refresh(); } };
  const register = async (endpoint: WebhookEndpoint) => { if (busy) return; setBusy(endpoint.id); setError(null); try { await api.registerIntegrationWebhook(connectionId, endpoint.inboxIds); } catch (error) { setError(error instanceof Error ? error.message : t("saveFailed")); } finally { setBusy(null); refresh(); } };
  const copy = async (url: string) => { try { await navigator.clipboard.writeText(url); toast.success(t("copied")); } catch { toast.error(t("copyFailed")); } };
  return <FieldGroup><Field><FieldLabel>{t("registeredWebhooks")}</FieldLabel>{error && <ListErrorState className="min-h-0 py-3" title={error} onRetry={refresh} />}{endpoints === null ? <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p> : endpoints.length === 0 ? <FieldDescription>{t("noWebhooks")}</FieldDescription> : <ul className="flex flex-col gap-3">{endpoints.map(endpoint => <ListItem key={endpoint.id} className="p-3" data-testid="connection-endpoint"><FieldGroup><Field><div className="flex flex-wrap items-center justify-between gap-2"><FieldLabel>{endpoint.name}</FieldLabel><Badge variant="secondary">{t(`states.${endpoint.state}`)}{!endpoint.enabled && ` · ${t("disabled")}`}</Badge></div><p className="break-all text-sm text-muted-foreground">{endpoint.inboxIds.join(", ")}</p><Input readOnly value={endpoint.receiveUrl} aria-label={t("receiveUrl")} />{endpoint.lastError && <FieldDescription role="alert">{endpoint.lastError}</FieldDescription>}<div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" size="sm" onClick={() => void copy(endpoint.receiveUrl)}><Copy data-icon="inline-start" />{t("copyUrl")}</Button>{canManage && <><Switch checked={endpoint.enabled} disabled={Boolean(busy) || endpoint.state === "pending"} aria-label={t("enableWebhook", { name: endpoint.name })} onCheckedChange={enabled => void change(endpoint, enabled)} />{endpoint.state !== "active" && <Button type="button" variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => void register(endpoint)}>{t("retryRegistration")}</Button>}<Button type="button" variant="destructive-ghost" size="icon" disabled={Boolean(busy)} aria-label={t("deleteNamed", { name: endpoint.name })} onClick={() => setDeleting(endpoint)}><Trash2 data-icon="inline-start" /></Button></>}</div></Field></FieldGroup></ListItem>)}</ul>}</Field><DeleteConfirmation open={Boolean(deleting)} onOpenChange={open => { if (!open) setDeleting(null); }} title={t("deleteTitle")} description={t("deleteDescription")} onConfirm={async () => { if (!deleting) return; try { await api.deleteWebhookEndpoint(deleting.id); setDeleting(null); } finally { refresh(); } }} /></FieldGroup>;
}
