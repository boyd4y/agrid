import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Copy, LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ApiKeyInfo, ApiKeyInput, CalendarPermission, BlogPermission, DocumentPermission, TablePermission } from "@tabdo/shared";
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
import { groupPermissionTables, operations, summarizePermissions, type ApiKeyTable } from "@/components/settings/api-key-permissions";

const blank = (): ApiKeyInput => ({ name: "", permissions: [], calendarPermissions: [], schedulePermissions: [], documentPermissions: [], blogPermissions: [] });

export function ApiKeysSettings() {
  const { t } = useTranslation(["app", "common"]);
  const text = (key: string, values?: Record<string, string | number>) => t(`settings.apiKeys.${key}`, values);
  const id = useId();
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]), [tables, setTables] = useState<ApiKeyTable[]>([]);
  const [calendars, setCalendars] = useState<{ id: string; name: string; workspaceName: string }[]>([]);
  const [schedules, setSchedules] = useState<{ id: string; name: string; workspaceName: string }[]>([]);
  const calendarOperations = ["canRead", "canReadAvailability", "canCreate", "canUpdate", "canCancel", "canManage", "canTriggerAgent", "canSubscribe", "canReadDeliveries", "canManageSubscriptions"] as const;
  const blogOperations = ["canRead", "canConfigure", "canBuild", "canPublish", "canRestore"] as const;
  const documentOperations = ["canRead", "canCreate", "canUpdate", "canReadHistory", "canRestore", "canUpload"] as const;
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
      if (!controller.signal.aborted) { setKeys(saved.keys); setTables(saved.tables); setCalendars(saved.calendars); setSchedules(saved.schedules ?? []); }
    })().catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  function edit(key?: ApiKeyInfo) {
    setInput(key ? { blogPermissions: (key.blogPermissions ?? []).map(p => ({ ...p })), documentPermissions: (key.documentPermissions ?? []).map(p => ({ ...p })), schedulePermissions: (key.schedulePermissions ?? []).map(p => ({ ...p })), name: key.name, permissions: key.permissions.map(p => ({ ...p })), calendarPermissions: (key.calendarPermissions ?? []).map(p => ({ ...p })) } : blank());
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
  function toggleBlog(tableId: string, operation: typeof blogOperations[number], checked: boolean) {
    setInput(current => {
      const grant: BlogPermission = { tableId, canRead: false, canConfigure: false, canBuild: false, canPublish: false, canRestore: false, ...current.blogPermissions?.find(p => p.tableId === tableId), [operation]: checked };
      return { ...current, blogPermissions: [...(current.blogPermissions ?? []).filter(p => p.tableId !== tableId), ...(blogOperations.some(op => grant[op]) ? [grant] : [])] };
    });
  }
  function toggleDocument(tableId: string, operation: typeof documentOperations[number], checked: boolean) {
    setInput(current => {
      const grant: DocumentPermission = { tableId, canRead: false, canCreate: false, canUpdate: false, canReadHistory: false, canRestore: false, canUpload: false, ...current.documentPermissions?.find(p => p.tableId === tableId), [operation]: checked };
      return { ...current, documentPermissions: [...(current.documentPermissions ?? []).filter(p => p.tableId !== tableId), ...(documentOperations.some(op => grant[op]) ? [grant] : [])] };
    });
  }
  function toggleCalendar(calendarId: string, operation: typeof calendarOperations[number], checked: boolean) {
    setInput(current => {
      const grant: CalendarPermission = { calendarId, canRead: false, canReadAvailability: false, canCreate: false, canUpdate: false, canCancel: false, canManage: false, ...current.calendarPermissions?.find(p => p.calendarId === calendarId), [operation]: checked };
      return { ...current, calendarPermissions: [...(current.calendarPermissions ?? []).filter(p => p.calendarId !== calendarId), ...(calendarOperations.some(op => grant[op]) ? [grant] : [])] };
    });
  }
  function permissionRow(tableId: string, name: string, label: string) {
    return <div key={tableId} className="grid grid-cols-[minmax(0,1fr)_repeat(4,2rem)] items-center gap-1 border-b p-2 text-sm last:border-b-0 hover:bg-muted focus-within:bg-muted sm:grid-cols-[minmax(0,1fr)_repeat(4,2.5rem)]">
      <span className="min-w-0 break-words" title={name}>{name}</span>
      {operations.map(op => <label key={op} className="flex min-h-8 cursor-pointer items-center justify-center rounded-sm hover:bg-accent"><Checkbox aria-label={`${label} · ${text(`operations.${op}`)}`} disabled={saving} checked={input.permissions.find(p => p.tableId === tableId)?.[op] ?? false} onCheckedChange={checked => toggle(tableId, op, checked === true)} /></label>)}
    </div>;
  }
  const create = canManage && <Button size="sm" disabled={!tables.length && !calendars.length && !schedules.length} onClick={() => edit()}><Plus className="hidden sm:block" data-icon="inline-start" />{text("create")}</Button>;
  return <section className="flex min-w-0 flex-col gap-6" data-testid="api-keys-settings">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-2"><CardTitle>{text("title")}</CardTitle><CardDescription>{text("description")}</CardDescription></div>
      <div className="flex items-center gap-2"><Button variant="ghost" size="icon" aria-label={t("common:refresh")} disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw data-icon="inline-start" /></Button>{!loading && !error && keys.length > 0 && create}</div>
    </header>
    {loading ? <p role="status" className="py-5 text-sm text-muted-foreground">{t("common:loading")}</p>
      : error ? <ListErrorState title={text("loadFailed")} onRetry={() => setRevision(value => value + 1)} />
      : !canManage ? <p className="py-5 text-sm text-muted-foreground">{text("adminOnly")}</p>
      : !keys.length ? <AppEmptyState density="compact" illustration={NOTIOLY.fastInternet} title={text("emptyTitle")} description={text(tables.length || calendars.length || schedules.length ? "emptyDescription" : "noTables")} action={create} />
      : <><ul className="border-y border-border" aria-label={text("title")}>
        {pagination.items.map(key => {
          const scope = summarizePermissions(key.permissions, tables);
          return <ListItem key={key.id} className="flex items-center gap-0 rounded-none border-x-0 border-t-0 p-0 last:border-b-0 sm:gap-2">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-sm py-3 text-left sm:px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" aria-label={text("editNamed", { name: key.name })} onClick={() => edit(key)}>
              <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate pr-8 text-sm font-medium sm:pr-0" title={key.name}>{key.name}</span>
                  <code className="text-xs text-muted-foreground">{key.prefix}…</code>
                </span>
                <span className="flex shrink-0 flex-col gap-1 text-xs text-muted-foreground">
                  <span>{scope.tableCount ? text("scopeSummary", { workspaces: text("workspaceCount", { count: scope.workspaceCount }), tables: text("tableCount", { count: scope.tableCount }) }) : text("noAuthorizedTables")}</span>
                  {!!key.blogPermissions?.length && <span>{t("blogs:grantCount", { count: key.blogPermissions.length })}</span>}
                  {!!key.schedulePermissions?.length && <span>{t("calendar:plans.scope", { count: key.schedulePermissions.length })}</span>}
                  {!!key.documentPermissions?.length && <span>{t("documents:documentScope", { count: key.documentPermissions.length })}</span>}
                  {!!key.calendarPermissions?.length && <span>{t("calendar:calendarScope", { count: key.calendarPermissions.length })}</span>}
                  {scope.unavailableCount > 0 && <span>{text("unavailableSummary", { count: scope.unavailableCount })}</span>}
                </span>
              </span>
              <ChevronRight className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
            </button>
            <Button className="absolute right-0 top-2 sm:static" variant="destructive-ghost" size="icon" aria-label={text("deleteNamed", { name: key.name })} onClick={() => setDeleting(key)}><Trash2 data-icon="inline-start" /></Button>
          </ListItem>;
        })}
      </ul>{pagination.totalPages > 1 && <ListPagination page={pagination.page} hasNext={pagination.hasNext} totalPages={pagination.totalPages} onPageChange={pagination.setPage} />}</>}
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
                <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,2rem)] sm:grid-cols-[minmax(0,1fr)_repeat(4,2.5rem)] items-center gap-1 border-b bg-muted/50 p-2 text-xs text-muted-foreground"><span>{text("tables")}</span>{operations.map(op => <span className="text-center" key={op}>{text(`operations.${op}`)}</span>)}</div>
                {groupPermissionTables(tables).map(group => <div key={group.workspaceId} role="group" aria-label={group.name}>
                  <div className="break-words border-b bg-muted/50 px-2 py-1.5 text-xs font-medium" title={group.workspaceId}>{group.name}</div>
                  {group.tables.map(table => permissionRow(table.id, table.name, `${group.name} / ${table.name}`))}
                </div>)}
                {input.permissions.filter(grant => !tables.some(table => table.id === grant.tableId)).map(grant => permissionRow(grant.tableId, `${text("removedTable")} (${grant.tableId})`, `${text("removedTable")} (${grant.tableId})`))}
              </div>
            </FieldSet>
            <FieldSet className="gap-3"><FieldLegend variant="label">{t("blogs:grantsTitle")}</FieldLegend><FieldDescription>{t("blogs:grantsHint")}</FieldDescription>
              {tables.map(table => <div key={table.id} className="flex flex-col gap-2 rounded-md border p-3"><span className="break-words text-sm font-medium">{table.workspaceName} / {table.name}</span><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{blogOperations.map(operation => <label key={operation} className="flex min-h-8 items-center gap-2 text-sm"><Checkbox disabled={saving} aria-label={`${table.name} · ${t(`blogs:grants.${operation}`)}`} checked={input.blogPermissions?.find(p => p.tableId === table.id)?.[operation] ?? false} onCheckedChange={checked => toggleBlog(table.id, operation, checked === true)} />{t(`blogs:grants.${operation}`)}</label>)}</div></div>)}
            </FieldSet>
            <FieldSet className="gap-3"><FieldLegend variant="label">{t("documents:grantsTitle")}</FieldLegend><FieldDescription>{t("documents:grantsHint")}</FieldDescription>
              {tables.map(table => <div key={table.id} className="flex flex-col gap-2 rounded-md border p-3"><span className="break-words text-sm font-medium">{table.workspaceName} / {table.name}</span><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{documentOperations.map(operation => <label key={operation} className="flex min-h-8 items-center gap-2 text-sm"><Checkbox disabled={saving} aria-label={`${table.name} · ${t(`documents:grants.${operation}`)}`} checked={input.documentPermissions?.find(p => p.tableId === table.id)?.[operation] ?? false} onCheckedChange={checked => toggleDocument(table.id, operation, checked === true)} />{t(`documents:grants.${operation}`)}</label>)}</div></div>)}
            </FieldSet>
            <FieldSet className="gap-3"><FieldLegend variant="label">{t("calendar:calendarGrants")}</FieldLegend><FieldDescription>{t("calendar:calendarGrantsHint")}</FieldDescription>
              {calendars.map(calendar => <div key={calendar.id} className="flex flex-col gap-2 rounded-md border p-3"><span className="break-words text-sm font-medium">{calendar.workspaceName} / {calendar.name}</span><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{calendarOperations.map(operation => <label key={operation} className="flex min-h-8 items-center gap-2 text-sm"><Checkbox disabled={saving} aria-label={`${calendar.name} · ${t(`calendar:grants.${operation}`)}`} checked={input.calendarPermissions?.find(p => p.calendarId === calendar.id)?.[operation] ?? false} onCheckedChange={checked => toggleCalendar(calendar.id, operation, checked === true)} />{t(`calendar:grants.${operation}`)}</label>)}</div></div>)}
            </FieldSet>
          </FieldGroup>
          {!!schedules.length && <FieldSet className="gap-3"><FieldLegend variant="label">{t("calendar:plans.grants")}</FieldLegend><FieldDescription>{t("calendar:plans.grantHint")}</FieldDescription><div className="divide-y border-y">{schedules.map(schedule => <div key={schedule.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"><span className="min-w-0 break-words">{schedule.workspaceName} · {schedule.name}</span><div className="flex gap-3">{(["canRead", "canUpdate"] as const).map(operation => <label key={operation} className="flex items-center gap-2"><Checkbox disabled={saving} aria-label={`${schedule.workspaceName} · ${schedule.name} · ${t(`calendar:plans.${operation}`)}`} checked={input.schedulePermissions?.find(p => p.automationId === schedule.id)?.[operation] ?? false} onCheckedChange={checked => setInput(current => { const grant = { automationId: schedule.id, canRead: false, canUpdate: false, ...current.schedulePermissions?.find(p => p.automationId === schedule.id), [operation]: checked === true }; return { ...current, schedulePermissions: [...(current.schedulePermissions ?? []).filter(p => p.automationId !== schedule.id), ...(grant.canRead || grant.canUpdate ? [grant] : [])] }; })} />{t(`calendar:plans.${operation}`)}</label>)}</div></div>)}</div></FieldSet>}
          {formError && <FieldError role="alert">{formError}</FieldError>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={close}>{t("common:cancel")}</Button><Button type="submit" disabled={saving || !input.name.trim() || !input.permissions.length && !input.calendarPermissions?.length && !input.schedulePermissions?.length && !input.documentPermissions?.length && !input.blogPermissions?.length}>{saving && <LoaderCircle className="animate-spin" data-icon="inline-start" />}{saving ? text("saving") : editor?.key ? t("common:save") : text("create")}</Button></div>
        </form>}
      </DialogContent>
    </Dialog>
    <DeleteConfirmation open={!!deleting} onOpenChange={open => { if (!open) setDeleting(null); }} title={text("deleteTitle")} description={text("deleteDescription", { name: deleting?.name ?? "" })} onConfirm={async () => {
      if (!deleting) return;
      const result = await api.deleteApiKey(deleting.id); setKeys(current => current.filter(key => key.id !== result.id));
    }} />
  </section>;
}
