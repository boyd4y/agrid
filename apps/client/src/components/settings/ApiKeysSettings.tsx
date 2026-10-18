import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Copy, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ApiKeyInfo, ApiKeyInput, CalendarPermission } from "@tabdo/shared";
import { api } from "@/lib/api";
import { enableGrokBot } from "@/components/settings/grok-bot";
import { Button } from "@tabdo/ui/components/button";
import { DataRefreshButton } from "@/components/controls/data-refresh-button";
import { Input } from "@tabdo/ui/components/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@tabdo/ui/components/collapsible";
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
import { authorizedTableIds, getTableAccess, groupPermissionResources, setTableAccess, summarizePermissions, tableOperations, type ApiKeyTable, type PermissionResource } from "@/components/settings/api-key-permissions";

const blank = (): ApiKeyInput => ({ name: "", permissions: [], calendarPermissions: [], schedulePermissions: [], documentPermissions: [], blogPermissions: [] });

export function ApiKeysSettings() {
  const { t } = useTranslation(["app", "common"]);
  const text = (key: string, values?: Record<string, string | number>) => t(`settings.apiKeys.${key}`, values);
  const id = useId();
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]), [tables, setTables] = useState<ApiKeyTable[]>([]);
  const [calendars, setCalendars] = useState<PermissionResource[]>([]);
  const [schedules, setSchedules] = useState<PermissionResource[]>([]);
  const calendarOperations = ["canRead", "canReadAvailability", "canCreate", "canUpdate", "canCancel", "canManage", "canTriggerAgent", "canSubscribe", "canReadDeliveries", "canManageSubscriptions"] as const;
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [canManage, setCanManage] = useState(false), [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<{ key?: ApiKeyInfo } | null>(null), [input, setInput] = useState<ApiKeyInput>(blank);
  const [secret, setSecret] = useState(""), [saving, setSaving] = useState(false), [formError, setFormError] = useState("");
  const [deleting, setDeleting] = useState<ApiKeyInfo | null>(null);
  const [grok, setGrok] = useState<{ key: ApiKeyInfo; secret?: string } | null>(null);
  const [enablingGrok, setEnablingGrok] = useState(false);
  const [grokPicker, setGrokPicker] = useState(false);
  const [grokTableIds, setGrokTableIds] = useState<string[]>([]);
  const grokBusy = useRef(false);
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
  async function startGrok() {
    if (!canManage || grokBusy.current) return;
    grokBusy.current = true; setEnablingGrok(true);
    try {
      const current = await api.listApiKeys();
      setKeys(current.keys); setTables(current.tables);
      const existing = current.keys.find(key => key.name === "Grok Bot");
      if (existing) { setGrok({ key: existing }); return; }
      if (!current.tables.length) { toast.error(text("grok.noTables")); return; }
      setGrokTableIds([]); setGrokPicker(true);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : text("saveFailed")); }
    finally { grokBusy.current = false; setEnablingGrok(false); }
  }
  async function enableGrok() {
    if (!canManage || grokBusy.current) return;
    grokBusy.current = true; setEnablingGrok(true);
    try {
      const saved = await enableGrokBot({ ...api, createApiKey: input => api.createApiKey(input.permissions.reduce(
        (current, grant) => setTableAccess(current, grant.tableId, { ...grant, canPublish: false }), input,
      )) }, grokTableIds);
      if (!saved) { toast.error(text("grok.selectTables")); return; }
      setKeys(current => [saved.key, ...current.filter(key => key.id !== saved.key.id)]); pagination.resetPage();
      setGrokPicker(false); setGrok(saved);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : text("saveFailed")); }
    finally { grokBusy.current = false; setEnablingGrok(false); }
  }
  function toggleCalendar(calendarId: string, operation: typeof calendarOperations[number], checked: boolean) {
    setInput(current => {
      const grant: CalendarPermission = { calendarId, canRead: false, canReadAvailability: false, canCreate: false, canUpdate: false, canCancel: false, canManage: false, ...current.calendarPermissions?.find(p => p.calendarId === calendarId), [operation]: checked };
      return { ...current, calendarPermissions: [...(current.calendarPermissions ?? []).filter(p => p.calendarId !== calendarId), ...(calendarOperations.some(op => grant[op]) ? [grant] : [])] };
    });
  }
  function permissionRow(tableId: string, name: string, label: string) {
    const { access, legacy } = getTableAccess(input, tableId);
    const legacySummary = () => {
      const summary = (grant: object | undefined, namespace: string) => Object.entries(grant ?? {})
        .filter(([key, value]) => key !== "tableId" && value === true)
        .map(([key]) => t(`${namespace}.${key}`)).join("、") || text("notGranted");
      const document = input.documentPermissions?.find(p => p.tableId === tableId);
      const blog = input.blogPermissions?.find(p => p.tableId === tableId);
      return [
        `${text("recordFields")}: ${summary(input.permissions.find(p => p.tableId === tableId), "app:settings.apiKeys.operations")}`,
        `${text("recordBody")}: ${summary(document && { canRead: document.canRead, canCreate: document.canCreate, canUpdate: document.canUpdate, canUpload: document.canUpload }, "documents:grants")}`,
        `${text("publication")}: ${summary(blog && { canRead: blog.canRead, canConfigure: blog.canConfigure, canBuild: blog.canBuild, canPublish: blog.canPublish }, "blogs:grants")}`,
        ...([document?.canReadHistory, document?.canRestore, blog?.canRestore].some(Boolean) ? [text("otherLegacyGrants")] : []),
      ].join("；");
    };
    return <FieldSet key={tableId} className="min-w-0 gap-2 border-b py-3 last:border-b-0" data-testid={`table-access-${tableId}`}>
      <FieldLegend variant="label" className="mb-0 break-words">{name}</FieldLegend>
      {legacy ? <>
        <FieldDescription>{text("legacyPreserved")}</FieldDescription>
        <p className="break-words text-xs text-muted-foreground">{legacySummary()}</p>
        <FieldDescription>{text("legacyConversion")}</FieldDescription>
        <Button type="button" variant="outline" size="sm" className="self-start" disabled={saving} aria-label={text("modifyTableNamed", { name: label })} onClick={() => setInput(current => setTableAccess(current, tableId, getTableAccess(current, tableId).access))}>{text("modifyTable")}</Button>
      </> : <FieldGroup className="flex flex-row flex-wrap gap-x-4 gap-y-1">
        {tableOperations.map(op => <Field key={op} orientation="horizontal" className="w-auto min-h-8" data-disabled={saving}>
          <Checkbox id={`${id}-${tableId}-${op}`} aria-label={`${label} · ${text(`operations.${op}`)}`} aria-describedby={op === "canPublish" ? `${id}-publish-description` : undefined} disabled={saving} checked={access[op]} onCheckedChange={checked => setInput(current => setTableAccess(current, tableId, { ...getTableAccess(current, tableId).access, [op]: checked === true }))} />
          <FieldLabel htmlFor={`${id}-${tableId}-${op}`}>{text(`operations.${op}`)}</FieldLabel>
        </Field>)}
      </FieldGroup>}
    </FieldSet>;
  }
  const create = canManage && <Button size="sm" disabled={!tables.length && !calendars.length && !schedules.length} onClick={() => edit()}><Plus className="hidden sm:block" data-icon="inline-start" />{text("create")}</Button>;
  return <section className="flex min-w-0 flex-col gap-6" data-testid="api-keys-settings">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-2"><CardTitle>{text("title")}</CardTitle><CardDescription>{text("description")}</CardDescription></div>
      <div className="flex items-center gap-2"><DataRefreshButton label={t("common:refresh")} disabled={loading} onRefresh={() => setRevision(value => value + 1)} />{!loading && !error && keys.length > 0 && create}</div>
    </header>
    {!loading && !error && canManage && <div className="flex flex-wrap items-center justify-between gap-3 border-y py-4">
      <div className="flex min-w-0 flex-col gap-1"><h3 className="text-sm font-medium">Grok Bot</h3><p className="text-sm text-muted-foreground">{text("grok.description")}</p></div>
      <Button variant="outline" size="sm" disabled={enablingGrok} onClick={() => void startGrok()}>{enablingGrok && <LoaderCircle className="animate-spin motion-reduce:animate-none" data-icon="inline-start" />}{text("grok.enable")}</Button>
    </div>}
    <Dialog open={grokPicker} onOpenChange={open => { if (!grokBusy.current) setGrokPicker(open); }}>
      <DialogContent closeLabel={t("common:close")} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{text("grok.enable")}</DialogTitle><DialogDescription>{text("grok.selectTables")}</DialogDescription></DialogHeader>
        <FieldSet>
          <FieldLegend variant="label">{text("permissions")} · {text("operations.canRead")}</FieldLegend>
          <FieldGroup className="max-h-64 overflow-y-auto rounded-md border p-3">
            {tables.map(table => <Field key={table.id} orientation="horizontal" data-disabled={enablingGrok}>
              <Checkbox id={`${id}-grok-table-${table.id}`} disabled={enablingGrok} checked={grokTableIds.includes(table.id)} onCheckedChange={checked => setGrokTableIds(current => checked === true ? [...current, table.id] : current.filter(value => value !== table.id))} />
              <FieldLabel htmlFor={`${id}-grok-table-${table.id}`} className="min-w-0 break-words">{table.workspaceName} / {table.name}</FieldLabel>
            </Field>)}
          </FieldGroup>
          <FieldDescription>{text("grok.selected", { tables: tables.filter(table => grokTableIds.includes(table.id)).map(table => `${table.workspaceName} / ${table.name}`).join(", ") || text("grok.none") })}</FieldDescription>
        </FieldSet>
        <Button disabled={enablingGrok || !grokTableIds.length} onClick={() => void enableGrok()}>{enablingGrok && <LoaderCircle className="animate-spin motion-reduce:animate-none" data-icon="inline-start" />}{text("grok.enable")}</Button>
      </DialogContent>
    </Dialog>
    <Dialog open={grok !== null} onOpenChange={open => { if (!open) setGrok(null); }}>
      <DialogContent closeLabel={t("common:close")} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{text("grok.title")}</DialogTitle><DialogDescription>{text(grok?.secret ? "once" : "grok.existing")}</DialogDescription></DialogHeader>
        {grok && <div className="flex min-w-0 flex-col gap-4">
          <p className="break-words text-sm">{grok.key.name} · {grok.key.prefix}… · {new Date(grok.key.createdAt).toLocaleString()} · {text("tableCount", { count: grok.key.permissions.length })}</p>
          <FieldGroup>
            {[...(grok.secret ? [{ label: text("grok.secret"), value: grok.secret }] : []), { label: text("grok.openapi"), value: `${window.location.origin}/api/openapi.json` }, { label: text("grok.manifest"), value: `${window.location.origin}/api/plugins/grok-bot` }].map((item, index) => <Field key={item.label}>
              <FieldLabel htmlFor={`${id}-grok-${index}`}>{item.label}</FieldLabel>
              <div className="flex min-w-0 gap-2"><Input id={`${id}-grok-${index}`} readOnly value={item.value} autoComplete="off" spellCheck={false} /><Button variant="outline" size="icon" aria-label={text("grok.copy", { label: item.label })} onClick={() => void copy(item.value)}><Copy data-icon="inline-start" /></Button></div>
            </Field>)}
          </FieldGroup>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">{["step1", "step2", "step3"].map(step => <li key={step}>{text(`grok.${step}`)}</li>)}</ol>
          <p className="text-sm text-muted-foreground">{text("grok.permissions")}</p>
          <Button variant="outline" onClick={() => { const key = grok.key; setGrok(null); edit(key); }}>{text("edit")}</Button>
        </div>}
      </DialogContent>
    </Dialog>
    {loading ? <p role="status" className="py-5 text-sm text-muted-foreground">{t("common:loading")}</p>
      : error ? <ListErrorState title={text("loadFailed")} onRetry={() => setRevision(value => value + 1)} />
      : !canManage ? <p className="py-5 text-sm text-muted-foreground">{text("adminOnly")}</p>
      : !keys.length ? <AppEmptyState density="compact" illustration={NOTIOLY.fastInternet} title={text("emptyTitle")} description={text(tables.length || calendars.length || schedules.length ? "emptyDescription" : "noTables")} action={create} />
      : <><ul className="border-y border-border" aria-label={text("title")}>
        {pagination.items.map(key => {
          const scope = summarizePermissions(authorizedTableIds(key).map(tableId => ({ tableId, canRead: true, canCreate: false, canUpdate: false, canDelete: false })), tables);
          return <ListItem key={key.id} className="flex items-center gap-0 rounded-none border-x-0 border-t-0 p-0 last:border-b-0 sm:gap-2">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-sm py-3 text-left sm:px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" aria-label={text("editNamed", { name: key.name })} onClick={() => edit(key)}>
              <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate pr-8 text-sm font-medium sm:pr-0" title={key.name}>{key.name}</span>
                  <code className="text-xs text-muted-foreground">{key.prefix}…</code>
                </span>
                <span className="flex shrink-0 flex-col gap-1 text-xs text-muted-foreground">
                  <span>{scope.tableCount ? text("scopeSummary", { workspaces: text("workspaceCount", { count: scope.workspaceCount }), tables: text("tableCount", { count: scope.tableCount }) }) : text("noAuthorizedTables")}</span>
                  {!!key.schedulePermissions?.length && <span>{t("calendar:plans.scope", { count: key.schedulePermissions.length })}</span>}
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
            <FieldDescription>{text("tablesHint")}</FieldDescription>
            <p id={`${id}-publish-description`} className="sr-only">{text("publishDescription")}</p>
            {groupPermissionResources(tables, calendars, schedules).map(group => <FieldSet key={group.workspaceId} className="min-w-0 gap-3" aria-label={group.name}>
              <FieldLegend>{group.name}</FieldLegend>
              <div className="min-w-0 border-y">
                {group.tables.map(table => permissionRow(table.id, table.name, `${group.name} / ${table.name}`))}
              </div>
              {(group.calendars.length > 0 || group.schedules.length > 0) && <Collapsible className="min-w-0">
                <CollapsibleTrigger asChild><Button type="button" variant="ghost" size="sm" className="max-w-full" aria-label={text("otherResourcesNamed", { name: group.name })}><ChevronRight className="size-4 in-data-[state=open]:rotate-90" aria-hidden />{text("otherResources", { count: (input.calendarPermissions ?? []).filter(p => group.calendars.some(c => c.id === p.calendarId)).length + (input.schedulePermissions ?? []).filter(p => group.schedules.some(c => c.id === p.automationId)).length })}</Button></CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <FieldGroup>
                    {group.calendars.map(calendar => <Collapsible key={calendar.id}>
                      <CollapsibleTrigger asChild><Button type="button" variant="outline" size="sm" className="h-auto max-w-full whitespace-normal text-left">{text("calendarResource", { name: calendar.name })} · {input.calendarPermissions?.some(p => p.calendarId === calendar.id) ? text("granted") : text("notGranted")}</Button></CollapsibleTrigger>
                      <CollapsibleContent className="pt-2"><FieldSet><FieldLegend variant="label" className="sr-only">{calendar.name}</FieldLegend><FieldGroup className="grid grid-cols-1 gap-1 sm:grid-cols-2">{calendarOperations.map(operation => <Field key={operation} orientation="horizontal" data-disabled={saving}>
                        <Checkbox id={`${id}-${calendar.id}-${operation}`} disabled={saving} aria-label={`${group.name} / ${calendar.name} · ${t(`calendar:grants.${operation}`)}`} checked={input.calendarPermissions?.find(p => p.calendarId === calendar.id)?.[operation] ?? false} onCheckedChange={checked => toggleCalendar(calendar.id, operation, checked === true)} />
                        <FieldLabel htmlFor={`${id}-${calendar.id}-${operation}`}>{t(`calendar:grants.${operation}`)}</FieldLabel>
                      </Field>)}</FieldGroup></FieldSet></CollapsibleContent>
                    </Collapsible>)}
                    {group.schedules.map(schedule => <FieldSet key={schedule.id} className="gap-2"><FieldLegend variant="label">{text("scheduleResource", { name: schedule.name })}</FieldLegend><FieldGroup className="flex flex-row flex-wrap gap-3">{(["canRead", "canUpdate"] as const).map(operation => <Field key={operation} orientation="horizontal" className="w-auto" data-disabled={saving}>
                      <Checkbox id={`${id}-${schedule.id}-${operation}`} disabled={saving} aria-label={`${group.name} / ${schedule.name} · ${t(`calendar:plans.${operation}`)}`} checked={input.schedulePermissions?.find(p => p.automationId === schedule.id)?.[operation] ?? false} onCheckedChange={checked => setInput(current => { const grant = { automationId: schedule.id, canRead: false, canUpdate: false, ...current.schedulePermissions?.find(p => p.automationId === schedule.id), [operation]: checked === true }; return { ...current, schedulePermissions: [...(current.schedulePermissions ?? []).filter(p => p.automationId !== schedule.id), ...(grant.canRead || grant.canUpdate ? [grant] : [])] }; })} />
                      <FieldLabel htmlFor={`${id}-${schedule.id}-${operation}`}>{t(`calendar:plans.${operation}`)}</FieldLabel>
                    </Field>)}</FieldGroup></FieldSet>)}
                  </FieldGroup>
                </CollapsibleContent>
              </Collapsible>}
            </FieldSet>)}
            {authorizedTableIds(input).filter(tableId => !tables.some(table => table.id === tableId)).map(tableId => permissionRow(tableId, `${text("removedTable")} (${tableId})`, `${text("removedTable")} (${tableId})`))}
          </FieldGroup>
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
