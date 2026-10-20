import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Copy, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ApiKeyInfo, ApiKeyInput, CalendarPermission } from "@tabdo/shared";
import { api } from "@/lib/api";
import { Button } from "@tabdo/ui/components/button";
import { DataRefreshButton } from "@/components/controls/data-refresh-button";
import { Input } from "@tabdo/ui/components/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@tabdo/ui/components/tabs";
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

const blank = (): ApiKeyInput => ({ name: "", permissions: [], calendarPermissions: [], schedulePermissions: [], automationPermissions: [], workspacePermissions: [] });

export function ApiKeysSettings() {
  const { t } = useTranslation(["app", "common"]);
  const text = (key: string, values?: Record<string, string | number>) => t(`settings.apiKeys.${key}`, values);
  const id = useId();
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]), [tables, setTables] = useState<ApiKeyTable[]>([]);
  const [calendars, setCalendars] = useState<PermissionResource[]>([]);
  const [automations, setAutomations] = useState<PermissionResource[]>([]);
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [schedules, setSchedules] = useState<PermissionResource[]>([]);
  const calendarOperations = ["canRead", "canReadAvailability", "canCreate", "canUpdate", "canCancel", "canManage", "canTriggerAgent", "canSubscribe", "canReadDeliveries", "canManageSubscriptions"] as const;
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
      if (!controller.signal.aborted) { setKeys(saved.keys); setTables(saved.tables); setCalendars(saved.calendars); setSchedules(saved.schedules ?? []); setAutomations(saved.automations); setWorkspaces(saved.workspaces); }
    })().catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  function edit(key?: ApiKeyInfo) {
    setInput(key ? { automationPermissions: (key.automationPermissions ?? []).map(p => ({ ...p })), workspacePermissions: (key.workspacePermissions ?? []).map(p => ({ ...p })), schedulePermissions: (key.schedulePermissions ?? []).map(p => ({ ...p })), name: key.name, permissions: key.permissions.map(p => ({ ...p })), calendarPermissions: (key.calendarPermissions ?? []).map(p => ({ ...p })) } : blank());
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
  function toggleCalendar(calendarId: string, operation: typeof calendarOperations[number], checked: boolean) {
    setInput(current => {
      const grant: CalendarPermission = { calendarId, canRead: false, canReadAvailability: false, canCreate: false, canUpdate: false, canCancel: false, canManage: false, ...current.calendarPermissions?.find(p => p.calendarId === calendarId), [operation]: checked };
      return { ...current, calendarPermissions: [...(current.calendarPermissions ?? []).filter(p => p.calendarId !== calendarId), ...(calendarOperations.some(op => grant[op]) ? [grant] : [])] };
    });
  }
  function toggleRule(kind: "automationPermissions" | "schedulePermissions", automationId: string, operation: "canRead" | "canUpdate" | "canDelete", checked: boolean) {
    setInput(current => {
      const grant = { automationId, canRead: false, canUpdate: false, canDelete: false, ...current[kind]?.find(p => p.automationId === automationId), [operation]: checked, ...(kind === "schedulePermissions" && operation === "canUpdate" ? { grantVersion: 2 as const } : {}) };
      return { ...current, [kind]: [...(current[kind] ?? []).filter(p => p.automationId !== automationId), ...(grant.canRead || grant.canUpdate || grant.canDelete ? [grant] : [])] };
    });
  }
  function toggleCreation(workspaceId: string, operation: "canCreateAutomations" | "canCreateSchedules", checked: boolean) {
    setInput(current => {
      const grant = { workspaceId, canCreateAutomations: false, canCreateSchedules: false, ...current.workspacePermissions?.find(p => p.workspaceId === workspaceId), [operation]: checked };
      return { ...current, workspacePermissions: [...(current.workspacePermissions ?? []).filter(p => p.workspaceId !== workspaceId), ...(grant.canCreateAutomations || grant.canCreateSchedules ? [grant] : [])] };
    });
  }
  const groups = groupPermissionResources(tables, calendars, schedules, automations, workspaces);
  const categories = ["tables", "automations", "calendars", "schedules"] as const;
  function resourceMatrix(category: typeof categories[number]) {
    const operations = category === "tables" ? tableOperations : category === "calendars" ? calendarOperations : ["canRead", "canUpdate", "canDelete"] as const;
    const style = { gridTemplateColumns: `minmax(220px, 1fr) repeat(${operations.length}, minmax(${category === "calendars" ? 76 : 100}px, 1fr))` };
    return <div className={category === "calendars" ? "min-w-[1040px]" : "min-w-[620px]"}>
      <div className="sticky top-0 grid items-center gap-2 border-b bg-background px-3 py-3 text-xs text-muted-foreground" style={style} aria-hidden>
        <span>{text("resource")}</span>{operations.map(operation => <span className="text-center" key={operation}>{category === "calendars" ? t(`calendar:grants.${operation}`) : text(`operations.${operation}`)}</span>)}
      </div>
      {groups.map(group => <FieldSet key={group.workspaceId} className="min-w-0 gap-0 border-b last:border-b-0" aria-label={group.name}>
        <FieldLegend variant="label" className="mb-0 w-full truncate bg-muted/40 px-3 py-2" title={group.name}>{group.name}</FieldLegend>
        {(category === "automations" || category === "schedules") && <Field orientation="horizontal" className="min-h-11 px-3" data-disabled={saving}>
          <Checkbox id={`${id}-${category}-${group.workspaceId}-create`} disabled={saving} checked={input.workspacePermissions?.find(p => p.workspaceId === group.workspaceId)?.[category === "automations" ? "canCreateAutomations" : "canCreateSchedules"] ?? false} onCheckedChange={checked => toggleCreation(group.workspaceId, category === "automations" ? "canCreateAutomations" : "canCreateSchedules", checked === true)} />
          <FieldLabel htmlFor={`${id}-${category}-${group.workspaceId}-create`}>{text("createInWorkspace")}</FieldLabel>
        </Field>}
        {group[category].length === 0 ? <p className="px-3 py-4 text-sm text-muted-foreground">{text("emptyResources")}</p> : group[category].map(resource => <div key={resource.id} className="grid min-h-12 items-center gap-2 border-t px-3 py-2" style={style} data-testid={`resource-access-${resource.id}`}>
          <span className="truncate text-sm" title={resource.name}>{resource.name}</span>
          {operations.map(operation => {
            const checked = category === "tables" ? getTableAccess(input, resource.id).access[operation as typeof tableOperations[number]] : category === "calendars" ? input.calendarPermissions?.find(p => p.calendarId === resource.id)?.[operation as typeof calendarOperations[number]] ?? false : input[category === "automations" ? "automationPermissions" : "schedulePermissions"]?.find(p => p.automationId === resource.id)?.[operation as "canRead" | "canUpdate" | "canDelete"] ?? false;
            const label = `${group.name} / ${resource.name} · ${category === "calendars" ? t(`calendar:grants.${operation}`) : text(`operations.${operation}`)}`;
            return <Field key={operation} orientation="horizontal" className="justify-center" data-disabled={saving}>
              <Checkbox aria-label={label} checked={checked} disabled={saving} onCheckedChange={value => {
                const enabled = value === true;
                if (category === "tables") setInput(current => setTableAccess(current, resource.id, { ...getTableAccess(current, resource.id).access, [operation]: enabled }));
                else if (category === "calendars") toggleCalendar(resource.id, operation as typeof calendarOperations[number], enabled);
                else toggleRule(category === "automations" ? "automationPermissions" : "schedulePermissions", resource.id, operation as "canRead" | "canUpdate" | "canDelete", enabled);
              }} />
            </Field>;
          })}
        </div>)}
      </FieldSet>)}
    </div>;
  }
  const create = canManage && <Button size="sm" disabled={!workspaces.length} onClick={() => edit()}><Plus className="hidden sm:block" data-icon="inline-start" />{text("create")}</Button>;
  return <section className="flex min-w-0 flex-col gap-6" data-testid="api-keys-settings">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-2"><CardTitle>{text("title")}</CardTitle><CardDescription>{text("description")}</CardDescription></div>
      <div className="flex flex-wrap items-center gap-2"><DataRefreshButton label={t("common:refresh")} disabled={loading} onRefresh={() => setRevision(value => value + 1)} />{!loading && !error && keys.length > 0 && create}</div>
    </header>
    {loading ? <p role="status" className="py-5 text-sm text-muted-foreground">{t("common:loading")}</p>
      : error ? <ListErrorState title={text("loadFailed")} onRetry={() => setRevision(value => value + 1)} />
      : !canManage ? <p className="py-5 text-sm text-muted-foreground">{text("adminOnly")}</p>
      : !keys.length ? <AppEmptyState density="compact" illustration={NOTIOLY.fastInternet} title={text("emptyTitle")} description={text(workspaces.length ? "emptyDescription" : "noTables")} action={create} />
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
                  {!!key.automationPermissions?.length && <span>{text("automationCount", { count: key.automationPermissions.length })}</span>}
                  {!!key.workspacePermissions?.length && <span>{text("creationCount", { count: key.workspacePermissions.length })}</span>}
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
      <DialogContent closeLabel={t("common:close")} className="flex max-h-[calc(100dvh-3rem)] flex-col overflow-hidden sm:max-w-[min(1180px,calc(100vw-4rem))]">
        <DialogHeader><DialogTitle>{text(secret ? "createdTitle" : editor?.key ? "edit" : "create")}</DialogTitle><DialogDescription>{text(secret ? "once" : "grantDescription")}</DialogDescription></DialogHeader>
        {secret ? <div className="flex flex-col gap-5">
          <Field><FieldLabel htmlFor={`${id}-secret`}>{text("key")}</FieldLabel><div className="flex gap-2"><Input id={`${id}-secret`} readOnly value={secret} autoComplete="off" spellCheck={false} className="min-w-0 font-mono" onFocus={event => event.currentTarget.select()} /><Button variant="outline" size="icon" aria-label={text("copyKey")} onClick={() => void copy(secret)}><Copy data-icon="inline-start" /></Button></div></Field>
          <div className="flex justify-end"><Button onClick={close}>{t("common:close")}</Button></div>
        </div> : <form noValidate onSubmit={save} className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          <FieldGroup className="shrink-0">
            <Field><FieldLabel htmlFor={`${id}-name`}>{text("name")}</FieldLabel><Input id={`${id}-name`} value={input.name} maxLength={100} autoComplete="off" disabled={saving} required onChange={event => setInput(current => ({ ...current, name: event.target.value }))} /></Field>
            <FieldDescription>{text("tablesHint")}</FieldDescription>
          </FieldGroup>
          <Tabs defaultValue="tables" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <TabsList className="shrink-0" aria-label={text("permissionTabs")}>
              {categories.map(category => <TabsTrigger key={category} value={category}>{text(`categories.${category}`)}</TabsTrigger>)}
            </TabsList>
            {categories.map(category => <TabsContent key={category} value={category} className="min-h-0 max-h-[48dvh] overflow-auto rounded-md border" data-testid={`permissions-${category}`}>{resourceMatrix(category)}</TabsContent>)}
          </Tabs>
          <div className="flex shrink-0 flex-col gap-3 border-t pt-4">
            {formError && <FieldError role="alert">{formError}</FieldError>}
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={close}>{t("common:cancel")}</Button><Button type="submit" disabled={saving || !input.name.trim() || !input.permissions.length && !input.calendarPermissions?.length && !input.schedulePermissions?.length && !input.automationPermissions?.length && !input.workspacePermissions?.length}>{saving && <LoaderCircle className="animate-spin" data-icon="inline-start" />}{saving ? text("saving") : editor?.key ? t("common:save") : text("create")}</Button></div>
          </div>
        </form>}
      </DialogContent>
    </Dialog>
    <DeleteConfirmation open={!!deleting} onOpenChange={open => { if (!open) setDeleting(null); }} title={text("deleteTitle")} description={text("deleteDescription", { name: deleting?.name ?? "" })} onConfirm={async () => {
      if (!deleting) return;
      const result = await api.deleteApiKey(deleting.id); setKeys(current => current.filter(key => key.id !== result.id));
    }} />
  </section>;
}
