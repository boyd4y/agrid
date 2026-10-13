import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Check, CircleCheck, Copy, Loader2, Mail, Plus, Webhook, X } from "lucide-react";
import type { IntegrationConnection, IntegrationInbox, WebhookEndpoint } from "@tabdo/shared";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/controls/dialog";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Field, FieldDescription, FieldLabel } from "@tabdo/ui/components/field";
import { Separator } from "@tabdo/ui/components/separator";
import { IntegrationCredentialsFields, IntegrationInboxSelection } from "./IntegrationFields";
import { api } from "@/lib/api";
import { toast } from "sonner";

export function IntegrationCreateDialog({ kind, onClose, onSaved }: { kind: "agentmail" | "webhook"; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation("integrations");
  const [name, setName] = useState(kind === "agentmail" ? "AgentMail" : ""), [apiKey, setApiKey] = useState("");
  const [connection, setConnection] = useState<IntegrationConnection | null>(null), [endpoint, setEndpoint] = useState<WebhookEndpoint | null>(null);
  const [step, setStep] = useState<0 | 1 | 2>(0), [inboxes, setInboxes] = useState<IntegrationInbox[]>([]), [selected, setSelected] = useState<string[]>([]), [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const pending = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const act = async (perform: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try { await perform(); } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : t("saveFailed")); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const connect = () => act(async () => {
    const saved = connection ? await api.updateIntegration(connection.id, { name, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }) : await api.createIntegration({ provider: "agentmail", name, apiKey: apiKey.trim() });
    setConnection(saved.connection); setApiKey(""); onSaved();
    const tested = await api.testIntegration(saved.connection.id);
    setConnection(tested.connection); onSaved();
    if (!tested.ok) throw new Error(tested.connection.lastError ?? t("testFailed"));
    const result = await api.listIntegrationInboxes(saved.connection.id);
    setInboxes(result.inboxes); setSelected(ids => ids.filter(id => result.inboxes.some(inbox => inbox.inboxId === id))); setStep(1);
  });
  const register = () => act(async () => {
    if (!connection) return;
    const result = await api.registerIntegrationWebhook(connection.id, selected);
    setEndpoint(result.endpoint); setStep(2); onSaved();
  });
  const createWebhook = () => act(async () => {
    const result = await api.createWebhookEndpoint(name);
    setEndpoint(result.endpoint); setToken(result.token); setStep(2); onSaved();
  });
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success(t("copied")); } catch { toast.error(t("copyFailed")); } };
  const Icon = kind === "agentmail" ? Mail : Webhook;
  const steps = [t("credentialStep"), t("inboxStep"), t("doneStep")];
  return <Dialog open onOpenChange={open => { if (!open && !pending.current) onClose(); }}><DialogContent data-testid="integration-create-dialog" className="flex max-h-[calc(100dvh-2rem)] max-w-xl flex-col gap-0 overflow-hidden p-0">
    <DialogHeader className="shrink-0 p-6 pr-12"><DialogTitle className="flex items-center gap-2"><Icon className="size-5" />{kind === "agentmail" ? t("newMail") : t("newWebhook")}</DialogTitle><DialogDescription>{step === 2 ? t("readyHint") : kind === "agentmail" ? t("createMailHint") : t("endpointHint")}</DialogDescription></DialogHeader>
    <Separator />
    <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-6">
      {kind === "agentmail" && <ol aria-label={t("setupSteps")} className="grid grid-cols-3 gap-2">{steps.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined} className="flex items-center gap-2 text-sm"><span className="flex size-6 shrink-0 items-center justify-center rounded-full border" aria-hidden>{index < step ? <Check className="size-3" /> : index + 1}</span><span className={index === step ? "font-medium" : "text-muted-foreground"}>{label}</span></li>)}</ol>}
      {step === 0 && <IntegrationCredentialsFields name={name} onName={setName} apiKey={apiKey} onApiKey={kind === "agentmail" ? setApiKey : undefined} stored={Boolean(connection)} disabled={busy} />}
      {step === 1 && <><p className="text-sm text-muted-foreground">{t("chooseInboxesHint")}</p><IntegrationInboxSelection inboxes={inboxes} selected={selected} onChange={setSelected} disabled={busy} />{!inboxes.length && <Button variant="outline" className="self-start" disabled={busy} onClick={() => void act(async () => { if (connection) setInboxes((await api.listIntegrationInboxes(connection.id)).inboxes); })}>{t("loadInboxes")}</Button>}</>}
      {step === 2 && <><div className="flex items-start gap-3"><CircleCheck className="size-6 shrink-0 text-primary" /><div><p className="font-medium">{kind === "agentmail" ? t("mailReady") : t("webhookReady")}</p><p className="mt-1 text-sm text-muted-foreground">{kind === "agentmail" ? t("mailReadyHint") : t("tokenOnce")}</p></div></div>{kind === "agentmail" && <p className="break-all text-sm text-muted-foreground">{inboxes.filter(inbox => selected.includes(inbox.inboxId)).map(inbox => inbox.address).join(", ")}</p>}{token && <Field><FieldLabel>{t("token")}</FieldLabel><Input readOnly value={token} aria-label={t("token")} /><Button type="button" className="self-start" variant="outline" size="sm" onClick={() => void copy(token)}><Copy data-icon="inline-start" />{t("copyToken")}</Button></Field>}{endpoint && <Field><FieldLabel>{t("receiveUrl")}</FieldLabel><Input readOnly value={endpoint.receiveUrl} aria-label={t("receiveUrl")} /><Button type="button" variant="outline" size="sm" className="self-start" onClick={() => void copy(endpoint.receiveUrl)}><Copy data-icon="inline-start" />{t("copyUrl")}</Button></Field>}</>}
      {error && <FieldDescription role="alert">{error}</FieldDescription>}
    </div>
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t p-4">{step === 1 && <Button type="button" variant="ghost" disabled={busy} className="mr-auto" onClick={() => { setStep(0); setError(null); }}><ArrowLeft data-icon="inline-start" />{t("back")}</Button>}{step !== 2 && <Button type="button" variant="outline" disabled={busy} onClick={onClose}><X data-icon="inline-start" />{t("common:cancel")}</Button>}{step === 2 ? <Button type="button" onClick={onClose}><Check data-icon="inline-start" />{t("done")}</Button> : <Button type="button" disabled={busy || !name.trim() || (step === 0 && kind === "agentmail" && !connection && !apiKey.trim()) || (step === 1 && !selected.length)} onClick={step === 1 ? register : kind === "agentmail" ? connect : createWebhook}>{busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : step === 0 && kind === "webhook" ? <Plus data-icon="inline-start" /> : <ArrowRight data-icon="inline-end" />}{busy ? t("saving") : step === 1 ? t("connectInboxes") : kind === "agentmail" ? t("saveAndContinue") : t("createEndpoint")}</Button>}</div>
  </DialogContent></Dialog>;
}
