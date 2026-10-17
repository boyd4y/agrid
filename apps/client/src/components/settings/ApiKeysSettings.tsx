import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, KeyRound, LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ApiKeyInfo, ApiKeyInput, TablePermission, TableMeta } from "@tabdo/shared";
import { api } from "@/lib/api";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Checkbox } from "@tabdo/ui/components/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@tabdo/ui/components/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@tabdo/ui/components/field";
import { CardDescription, CardTitle } from "@tabdo/ui/components/card";
import { ListItem } from "@tabdo/ui/components/list-item";
import { DeleteConfirmation } from "@/components/controls/delete-confirmation";
import { ListPagination } from "@/components/controls/list-pagination";
import { useArrayPagination } from "@/hooks/useListPagination";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";

const blank = (): ApiKeyInput => ({ name: "", permissions: [] });
const operations = ["canRead", "canCreate", "canUpdate", "canDelete"] as const;

export function ApiKeysSettings() {
  const { t } = useTranslation(["app", "common"]);
  const text = (key: string, values?: Record<string, string | number>) => t(`settings.apiKeys.${key}`, values);
  const id = useId();
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]), [tables, setTables] = useState<TableMeta[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [canManage, setCanManage] = useState(false), [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<{ key?: ApiKeyInfo } | null>(null), [input, setInput] = useState<ApiKeyInput>(blank);
  const [secret, setSecret] = useState(""), [saving, setSaving] = useState(false), [formError, setFormError] = useState("");
  const [deleting, setDeleting] = useState<ApiKeyInfo | null>(null);
  const busy = useRef(false);
  const pagination = useArrayPagination(keys);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false);
    void (async () => {
      const members = await api.listMembers();
      const allowed = ["owner", "admin"].includes(members.actor?.role ?? "");
      if (controller.signal.aborted) return;
      setCanManage(allowed);
      if (!allowed) return;
      const saved = await api.listApiKeys(controller.signal);
      const allTables = saved.tables.map(table => ({ ...table, name: `${table.workspaceName} / ${table.name}` }));
      if (!controller.signal.aborted) { setKeys(saved.keys); setTables(allTables); }
    })().catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  function edit(key?: ApiKeyInfo) {
    setInput(key ? { name: key.name, permissions: key.permissions.map(p => ({ ...p })) } : blank());
    setSecret(""); setFormError(""); setEditor({ key });
  }
  function close() { if (busy.current) return; setEditor(null); setSecret(""); setFormError(""); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy.current) return;
    busy.current = true; setSaving(true); setFormError("");
    try {
      if (editor?.key) {
        const saved = await api.updateApiKey(editor.key.id, input);
        setKeys(current => current.map(key => key.id === saved.key.id ? saved.key : key));
        setEditor(null);
      } else {
        const saved = await api.createApiKey(input);
        setKeys(current => [saved.key, ...current]); setSecret(saved.secret); pagination.resetPage();
      }
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : text("saveFailed")); }
    finally { busy.current = false; setSaving(false); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); toast.success(text("copied")); }
    catch { toast.error(text("copyFailed")); }
  }
  function toggle(tableId: string, operation: typeof operations[number], checked: boolean) {
    setInput(current => {
      const grant: TablePermission = { tableId, canRead: false, canCreate: false, canUpdate: false, canDelete: false, ...current.permissions.find(p => p.tableId === tableId), [operation]: checked };
      return { ...current, permissions: [...current.permissions.filter(p => p.tableId !== tableId), ...(operations.some(op => grant[op]) ? [grant] : [])] };
    });
  }
  const create = canManage && <Button size="sm" disabled={!tables.length} onClick={() => edit()}><Plus data-icon="inline-start" />{text("create")}</Button>;
  return <section className="flex min-w-0 flex-col gap-6" data-testid="api-keys-settings">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-2"><CardTitle>{text("title")}</CardTitle><CardDescription>{text("description")}</CardDescription></div>
      <div className="flex items-center gap-2"><Button variant="ghost" size="icon" aria-label={t("common:refresh")} disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw data-icon="inline-start" /></Button>{!loading && !error && keys.length > 0 && create}</div>
    </header>
    {loading ? <p role="status" className="py-5 text-sm text-muted-foreground">{t("common:loading")}</p>
      : error ? <ListErrorState title={text("loadFailed")} onRetry={() => setRevision(value => value + 1)} />
      : !canManage ? <p className="py-5 text-sm text-muted-foreground">{text("adminOnly")}</p>
      : !keys.length ? <AppEmptyState density="compact" illustration={NOTIOLY.fastInternet} title={text("emptyTitle")} description={text(tables.length ? "emptyDescription" : "noTables")} action={create} />
      : <><ul className="flex flex-col gap-3" aria-label={text("title")}>
        {pagination.items.map(key => <ListItem key={key.id} className="flex items-start gap-3">
          <button type="button" className="absolute inset-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={text("editNamed", { name: key.name })} onClick={() => edit(key)} />
          <span className="pointer-events-none flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"><KeyRound className="size-4 text-muted-foreground" aria-hidden /></span>
          <div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-2">
            <h3 className="truncate text-sm font-medium">{key.name}</h3>
            <p className="line-clamp-2 break-words text-xs text-muted-foreground">{key.permissions.map(grant => `${tables.find(table => table.id === grant.tableId)?.name ?? text("removedTable")}：${operations.filter(op => grant[op]).map(op => text(`operations.${op}`)).join(" / ")}`).join(" · ") || text("noAuthorizedTables")}</p>
            <div className="flex flex-wrap items-center gap-2"><code className="text-xs text-muted-foreground">{key.prefix}…</code></div>
          </div>
          <Button className="relative" variant="destructive-ghost" size="icon" aria-label={text("deleteNamed", { name: key.name })} onClick={() => setDeleting(key)}><Trash2 data-icon="inline-start" /></Button>
        </ListItem>)}
      </ul><ListPagination page={pagination.page} hasNext={pagination.hasNext} totalPages={pagination.totalPages} onPageChange={pagination.setPage} /></>}
    <Dialog open={editor !== null} onOpenChange={open => { if (!open) close(); }}>
      <DialogContent closeLabel={t("common:close")} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{text(secret ? "createdTitle" : editor?.key ? "edit" : "create")}</DialogTitle><DialogDescription>{text(secret ? "once" : "grantDescription")}</DialogDescription></DialogHeader>
        {secret ? <div className="flex flex-col gap-5">
          <Field><FieldLabel htmlFor={`${id}-secret`}>{text("key")}</FieldLabel><div className="flex gap-2"><Input id={`${id}-secret`} readOnly value={secret} autoComplete="off" spellCheck={false} className="min-w-0 font-mono" onFocus={event => event.currentTarget.select()} /><Button variant="outline" size="icon" aria-label={text("copyKey")} onClick={() => void copy(secret)}><Copy data-icon="inline-start" /></Button></div></Field>
          <div className="flex justify-end"><Button onClick={close}>{t("common:close")}</Button></div>
        </div> : <form noValidate onSubmit={save} className="flex flex-col gap-5">
          <FieldGroup>
            <Field><FieldLabel htmlFor={`${id}-name`}>{text("name")}</FieldLabel><Input id={`${id}-name`} value={input.name} maxLength={100} autoComplete="off" disabled={saving} required onChange={event => setInput(current => ({ ...current, name: event.target.value }))} /></Field>
            <FieldSet className="gap-3"><FieldLegend variant="label">{text("permissions")}</FieldLegend><FieldDescription>{text("tablesHint")}</FieldDescription>
              <div className="max-h-72 overflow-y-auto rounded-md border">
                <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,2.5rem)] items-center gap-1 border-b bg-muted/50 p-2 text-xs text-muted-foreground"><span>{text("tables")}</span>{operations.map(op => <span className="text-center" key={op}>{text(`operations.${op}`)}</span>)}</div>
                {tables.map(table => <div key={table.id} className="grid grid-cols-[minmax(0,1fr)_repeat(4,2.5rem)] items-center gap-1 border-b p-2 text-sm last:border-b-0 hover:bg-muted focus-within:bg-muted">
                  <span className="min-w-0 truncate" title={table.name}>{table.name}</span>
                  {operations.map(op => <label key={op} className="flex min-h-8 cursor-pointer items-center justify-center rounded-sm hover:bg-accent"><Checkbox aria-label={`${table.name} · ${text(`operations.${op}`)}`} disabled={saving} checked={input.permissions.find(p => p.tableId === table.id)?.[op] ?? false} onCheckedChange={checked => toggle(table.id, op, checked === true)} /></label>)}
                </div>)}
              </div>
            </FieldSet>
          </FieldGroup>
          {formError && <FieldError role="alert">{formError}</FieldError>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={close}>{t("common:cancel")}</Button><Button type="submit" disabled={saving || !input.name.trim() || !input.permissions.length}>{saving && <LoaderCircle className="animate-spin" data-icon="inline-start" />}{saving ? text("saving") : editor?.key ? t("common:save") : text("create")}</Button></div>
        </form>}
      </DialogContent>
    </Dialog>
    <DeleteConfirmation open={!!deleting} onOpenChange={open => { if (!open) setDeleting(null); }} title={text("deleteTitle")} description={text("deleteDescription", { name: deleting?.name ?? "" })} onConfirm={async () => {
      if (!deleting) return;
      const result = await api.deleteApiKey(deleting.id); setKeys(current => current.filter(key => key.id !== result.id));
    }} />
  </section>;
}
