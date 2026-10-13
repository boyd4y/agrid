import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, KeyRound, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type UserApiKeyInfo } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tabdo/ui/components/card";
import { Button } from "@tabdo/ui/components/button";
import { Badge } from "@tabdo/ui/components/badge";
import { Input } from "@tabdo/ui/components/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@tabdo/ui/components/field";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@tabdo/ui/components/dialog";
import { DeleteConfirmation } from "@/components/controls/delete-confirmation";
import { ListErrorState } from "@/components/shell/ListErrorState";

/** Only metadata survives closing the creation dialog; the secret stays in this component's memory. */
export function ApiKeysSettings() {
  const { t, i18n } = useTranslation(["app", "common"]);
  const text = (key: string, values?: Record<string, string>) => t(`settings.apiKeys.${key}`, values);
  const id = useId();
  const [keys, setKeys] = useState<UserApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState<UserApiKeyInfo | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError(false);
    api.listApiKeys(controller.signal).then(result => {
      if (!controller.signal.aborted) setKeys(result.keys);
    }).catch(() => { if (!controller.signal.aborted) setLoadError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);

  function changeOpen(value: boolean) {
    if (creatingRef.current) return;
    setOpen(value);
    if (!value) { setName(""); setSecret(""); setError(""); }
  }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (creatingRef.current || !name.trim()) return;
    creatingRef.current = true; setCreating(true); setError("");
    try {
      const result = await api.createApiKey(name.trim());
      setKeys(previous => [result.key, ...previous]);
      setSecret(result.secret);
    } catch (cause) { setError(cause instanceof Error ? cause.message : text("createFailed")); }
    finally { creatingRef.current = false; setCreating(false); }
  }

  return <Card className="shrink-0">
    <CardHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2"><KeyRound className="size-4" aria-hidden />{text("title")}</CardTitle>
        <Button size="sm" disabled={loading} onClick={() => changeOpen(true)}><Plus data-icon="inline-start" />{text("create")}</Button>
      </div>
      <CardDescription>{text("description")}</CardDescription>
    </CardHeader>
    <CardContent>
      {loading ? <p role="status" className="py-4 text-sm text-muted-foreground">{t("common:loading")}</p>
        : loadError ? <ListErrorState title={text("loadFailed")} onRetry={() => setRefresh(value => value + 1)} className="min-h-0 py-5" />
        : keys.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{text("empty")}</p>
        : <ul className="divide-y divide-border" aria-label={text("title")}>
          {keys.map(key => <li key={key.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{key.name}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <code>{key.prefix}…</code>
                <span>{text("createdAt", { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(new Date(key.createdAt)) })}</span>
              </p>
            </div>
            {key.revokedAt ? <Badge variant="secondary">{text("revoked")}</Badge>
              : <Button variant="destructive-ghost" size="icon" aria-label={text("revokeAria", { name: key.name })} onClick={() => setRevoking(key)}><Trash2 data-icon="inline-start" /></Button>}
          </li>)}
        </ul>}
    </CardContent>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent closeLabel={t("common:close")}>
        <DialogHeader><DialogTitle>{text(secret ? "createdTitle" : "create")}</DialogTitle><DialogDescription>{text(secret ? "once" : "description")}</DialogDescription></DialogHeader>
        {secret ? <>
          <Field>
            <FieldLabel htmlFor={`${id}-secret`}>{text("secretLabel")}</FieldLabel>
            <div className="flex gap-2">
              <Input id={`${id}-secret`} readOnly value={secret} className="font-mono" autoComplete="off" spellCheck={false} onFocus={event => event.currentTarget.select()} />
              <Button variant="outline" size="icon" aria-label={text("copy")} onClick={async () => {
                try { await navigator.clipboard.writeText(secret); toast.success(text("copied")); }
                catch { toast.error(text("copyFailed")); }
              }}><Copy data-icon="inline-start" /></Button>
            </div>
            <FieldDescription>{text("usage")}</FieldDescription>
          </Field>
          <div className="flex justify-end"><Button onClick={() => changeOpen(false)}>{t("common:close")}</Button></div>
        </> : <form onSubmit={create} className="flex flex-col gap-5">
          <FieldGroup><Field data-invalid={!!error}>
            <FieldLabel htmlFor={`${id}-name`}>{text("name")}</FieldLabel>
            <Input id={`${id}-name`} value={name} onChange={event => { setName(event.target.value); setError(""); }} placeholder={text("namePlaceholder")} maxLength={100} autoComplete="off" disabled={creating} required aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} />
            {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
          </Field></FieldGroup>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={creating} onClick={() => changeOpen(false)}>{t("common:cancel")}</Button>
            <Button type="submit" disabled={creating || !name.trim()}>{creating && <LoaderCircle className="animate-spin" data-icon="inline-start" />}{text(creating ? "creating" : "create")}</Button>
          </div>
        </form>}
      </DialogContent>
    </Dialog>
    <DeleteConfirmation open={!!revoking} onOpenChange={value => { if (!value) setRevoking(null); }} title={text("revokeTitle")} description={text("revokeDescription", { name: revoking?.name ?? "" })} labels={{ confirmDelete: text("revoke"), deleting: text("revoking") }} onConfirm={async () => {
      if (!revoking) return;
      const result = await api.revokeApiKey(revoking.id);
      setKeys(previous => previous.map(key => key.id === result.key.id ? result.key : key));
    }} />
  </Card>;
}
