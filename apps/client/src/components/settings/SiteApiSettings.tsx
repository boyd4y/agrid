import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Globe, LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { SiteKeyInfo, SiteKeyInput, TableMeta } from "@tabdo/shared";
import { api } from "@/lib/api";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Textarea } from "@tabdo/ui/components/textarea";
import { Checkbox } from "@tabdo/ui/components/checkbox";
import { Badge } from "@tabdo/ui/components/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@tabdo/ui/components/select";
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

const blank = (): SiteKeyInput => ({ name: "", tableIds: [], canRead: true, canCreate: false });
type Mode = "read" | "create" | "both";
function modeOf(key: SiteKeyInput): Mode { return key.canRead && key.canCreate ? "both" : key.canCreate ? "create" : "read"; }

export function SiteApiSettings() {
  const { t } = useTranslation(["app", "common"]);
  const text = (key: string, values?: Record<string, string | number>) => t(`settings.siteApi.${key}`, values);
  const id = useId();
  const [keys, setKeys] = useState<SiteKeyInfo[]>([]), [tables, setTables] = useState<TableMeta[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [canManage, setCanManage] = useState(false), [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<{ key?: SiteKeyInfo } | null>(null), [input, setInput] = useState<SiteKeyInput>(blank);
  const [secret, setSecret] = useState(""), [saving, setSaving] = useState(false), [formError, setFormError] = useState("");
  const [deleting, setDeleting] = useState<SiteKeyInfo | null>(null);
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
      const [saved, allTables] = await Promise.all([api.listSiteKeys(controller.signal), api.listTables()]);
      if (!controller.signal.aborted) { setKeys(saved.keys); setTables(allTables); }
    })().catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  function edit(key?: SiteKeyInfo) {
    setInput(key ? { name: key.name, tableIds: [...key.tableIds], canRead: key.canRead, canCreate: key.canCreate } : blank());
    setSecret(""); setFormError(""); setEditor({ key });
  }
  function close() { if (busy.current) return; setEditor(null); setSecret(""); setFormError(""); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy.current) return;
    busy.current = true; setSaving(true); setFormError("");
    try {
      if (editor?.key) {
        const saved = await api.updateSiteKey(editor.key.id, input);
        setKeys(current => current.map(key => key.id === saved.key.id ? saved.key : key));
        setEditor(null);
      } else {
        const saved = await api.createSiteKey(input);
        setKeys(current => [saved.key, ...current]); setSecret(saved.secret); pagination.resetPage();
      }
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : text("saveFailed")); }
    finally { busy.current = false; setSaving(false); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); toast.success(text("copied")); }
    catch { toast.error(text("copyFailed")); }
  }
  const snippet = `import { createClient } from "@tabdo/sdk";\n\nconst tabdo = createClient({\n  url: ${JSON.stringify(window.location.origin)},\n  key: ${JSON.stringify(secret)},\n});\n\nconst table = tabdo.table(${JSON.stringify(input.tableIds[0] ?? "TABLE_ID")});\n${input.canRead ? 'const page = await table.list({ limit: 20 });\nconsole.log(page.rows);' : 'const fields = await table.columns();\nconst title = fields.find(field => field.type === "text" && field.writable);\nif (title) await table.create({ [title.id]: "Hello" });'}`;
  const create = canManage && <Button size="sm" disabled={!tables.length} onClick={() => edit()}><Plus data-icon="inline-start" />{text("create")}</Button>;
  return <section className="flex min-w-0 flex-col gap-6" data-testid="site-api-settings">
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
          <span className="pointer-events-none flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"><Globe className="size-4 text-muted-foreground" aria-hidden /></span>
          <div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-2">
            <h3 className="truncate text-sm font-medium">{key.name}</h3>
            <p className="line-clamp-2 break-words text-xs text-muted-foreground">{key.tableIds.map(tableId => tables.find(table => table.id === tableId)?.name ?? text("removedTable")).join(" · ") || text("noAuthorizedTables")}</p>
            <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{text(`modes.${modeOf(key)}`)}</Badge><code className="text-xs text-muted-foreground">{key.prefix}…</code></div>
          </div>
          <Button className="relative" variant="destructive-ghost" size="icon" aria-label={text("deleteNamed", { name: key.name })} onClick={() => setDeleting(key)}><Trash2 data-icon="inline-start" /></Button>
        </ListItem>)}
      </ul><ListPagination page={pagination.page} hasNext={pagination.hasNext} totalPages={pagination.totalPages} onPageChange={pagination.setPage} /></>}
    <Dialog open={editor !== null} onOpenChange={open => { if (!open) close(); }}>
      <DialogContent closeLabel={t("common:close")} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{text(secret ? "createdTitle" : editor?.key ? "edit" : "create")}</DialogTitle><DialogDescription>{text(secret ? "once" : "grantDescription")}</DialogDescription></DialogHeader>
        {secret ? <div className="flex flex-col gap-5">
          <Field><FieldLabel htmlFor={`${id}-secret`}>{text("key")}</FieldLabel><div className="flex gap-2"><Input id={`${id}-secret`} readOnly value={secret} autoComplete="off" spellCheck={false} className="min-w-0 font-mono" onFocus={event => event.currentTarget.select()} /><Button variant="outline" size="icon" aria-label={text("copyKey")} onClick={() => void copy(secret)}><Copy data-icon="inline-start" /></Button></div></Field>
          <Field><div className="flex items-center justify-between gap-2"><FieldLabel htmlFor={`${id}-code`}>{text("example")}</FieldLabel><Button variant="ghost" size="sm" onClick={() => void copy(snippet)}><Copy data-icon="inline-start" />{text("copyCode")}</Button></div><Textarea id={`${id}-code`} readOnly value={snippet} className="min-h-64 font-mono text-xs" autoComplete="off" spellCheck={false} /></Field>
          <div className="flex justify-end"><Button onClick={close}>{t("common:close")}</Button></div>
        </div> : <form noValidate onSubmit={save} className="flex flex-col gap-5">
          <FieldGroup>
            <Field><FieldLabel htmlFor={`${id}-name`}>{text("name")}</FieldLabel><Input id={`${id}-name`} value={input.name} maxLength={100} autoComplete="off" disabled={saving} required onChange={event => setInput(current => ({ ...current, name: event.target.value }))} /></Field>
            <Field><FieldLabel htmlFor={`${id}-mode`}>{text("permissions")}</FieldLabel>
              <Select value={modeOf(input)} disabled={saving} onValueChange={mode => setInput(current => ({ ...current, canRead: mode !== "create", canCreate: mode !== "read" }))}><SelectTrigger id={`${id}-mode`}><SelectValue /></SelectTrigger><SelectContent>{(["read", "create", "both"] as const).map(mode => <SelectItem key={mode} value={mode}>{text(`modes.${mode}`)}</SelectItem>)}</SelectContent></Select>
            </Field>
            <FieldSet className="gap-2"><FieldLegend variant="label">{text("tables")}</FieldLegend><FieldDescription>{text("tablesHint")}</FieldDescription>
              <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border p-2" role="group" aria-label={text("tables")}>
                {tables.map(table => <label key={table.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted focus-within:bg-muted"><Checkbox disabled={saving} checked={input.tableIds.includes(table.id)} onCheckedChange={checked => setInput(current => ({ ...current, tableIds: checked === true ? [...current.tableIds, table.id] : current.tableIds.filter(value => value !== table.id) }))} /><span className="min-w-0 truncate">{table.name}</span></label>)}
              </div>
            </FieldSet>
          </FieldGroup>
          {formError && <FieldError role="alert">{formError}</FieldError>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={close}>{t("common:cancel")}</Button><Button type="submit" disabled={saving || !input.name.trim() || !input.tableIds.length}>{saving && <LoaderCircle className="animate-spin" data-icon="inline-start" />}{saving ? text("saving") : editor?.key ? t("common:save") : text("create")}</Button></div>
        </form>}
      </DialogContent>
    </Dialog>
    <DeleteConfirmation open={!!deleting} onOpenChange={open => { if (!open) setDeleting(null); }} title={text("deleteTitle")} description={text("deleteDescription", { name: deleting?.name ?? "" })} onConfirm={async () => {
      if (!deleting) return;
      const result = await api.deleteSiteKey(deleting.id); setKeys(current => current.filter(key => key.id !== result.id));
    }} />
  </section>;
}
