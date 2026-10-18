import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Copy, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { CALENDAR_EVENT_TYPES, type Calendar, type CalendarEventType, type CalendarSubscription, type CalendarSubscriptionPage } from "@tabdo/shared";
import { calendarCommand } from "@/lib/calendar-api";
import { api } from "@/lib/api";
import { CalendarDeliveryHistory } from "@/components/settings/CalendarDeliveryHistory";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { DataRefreshButton } from "@/components/controls/data-refresh-button";
import { ListPagination } from "@/components/controls/list-pagination";
import { DeleteConfirmation } from "@/components/controls/delete-confirmation";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Checkbox } from "@tabdo/ui/components/checkbox";
import { Badge } from "@tabdo/ui/components/badge";
import { CardDescription } from "@tabdo/ui/components/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@tabdo/ui/components/dialog";
import { Field, FieldLabel, FieldDescription, FieldError, FieldGroup, FieldSet, FieldLegend } from "@tabdo/ui/components/field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "@tabdo/ui/components/select";

type Draft = { subscription?: CalendarSubscription; name: string; endpoint: string; eventTypes: CalendarEventType[]; requestKey: string };
export function CalendarSubscriptionsSettings() {
  const { t } = useTranslation("calendar");
  const [calendars, setCalendars] = useState<Calendar[]>([]), [calendarId, setCalendarId] = useState("");
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [allowed, setAllowed] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    void (async () => {
      const members = await api.listMembers(); if (controller.signal.aborted) return;
      const canManage = ["owner", "admin"].includes(members.actor?.role ?? ""); setAllowed(canManage);
      if (!canManage) return;
      const result = await calendarCommand("listCalendars", { includeArchived: true }, controller.signal);
      setCalendars(result.items); setCalendarId(current => result.items.some(c => c.id === current) ? current : result.items[0]?.id ?? "");
    })().catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  return <section className="flex min-w-0 flex-col gap-5" data-testid="calendar-subscriptions-settings">
    <header className="flex items-start justify-between gap-3"><CardDescription>{t("subscriptions.description")}</CardDescription><DataRefreshButton disabled={loading} onRefresh={() => setRevision(v => v + 1)} /></header>
    {loading && !calendars.length ? <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p> : error ? <ListErrorState description={error} onRetry={() => setRevision(v => v + 1)} /> : !allowed ? <p className="text-sm text-muted-foreground">{t("subscriptions.adminOnly")}</p> : !calendars.length ? <AppEmptyState density="compact" illustration={NOTIOLY.fastInternet} title={t("subscriptions.noCalendars")} description={t("subscriptions.noCalendarsHint")} /> : <>
      <Field><FieldLabel>{t("calendar")}</FieldLabel><Select value={calendarId} onValueChange={setCalendarId}><SelectTrigger aria-label={t("calendar")}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{calendars.map(calendar => <SelectItem key={calendar.id} value={calendar.id}>{calendar.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
      {calendarId && <SubscriptionList key={calendarId} calendar={calendars.find(c => c.id === calendarId)!} refreshToken={revision} />}
    </>}
  </section>;
}
function SubscriptionList({ calendar, refreshToken }: { calendar: Calendar; refreshToken: number }) {
  const { t } = useTranslation("calendar"), id = useId();
  const [page, setPage] = useState<CalendarSubscriptionPage<CalendarSubscription>>(), [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [revision, setRevision] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft>(), [secret, setSecret] = useState(""), [formError, setFormError] = useState(""), [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<CalendarSubscription>(), [revoking, setRevoking] = useState<CalendarSubscription>();
  const [rotation, setRotation] = useState<CalendarSubscription>(), [rotationError, setRotationError] = useState("");
  const busy = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const calendarId = calendar.id, cursor = cursors.at(-1);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    void calendarCommand("listCalendarSubscriptions", { calendarId, cursor }, controller.signal).then(setPage).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [calendarId, cursor, revision, refreshToken]);
  const refresh = () => setRevision(v => v + 1);
  function edit(subscription?: CalendarSubscription) {
    setSecret(""); setFormError(""); setDraft({ subscription, name: subscription?.name ?? "", endpoint: subscription?.endpoint ?? "", eventTypes: subscription?.eventTypes ?? ["booking.created", "booking.rescheduled", "booking.cancelled"], requestKey: crypto.randomUUID() });
  }
  function change(values: Partial<Draft>) { setDraft(current => current ? { ...current, ...values, requestKey: crypto.randomUUID() } : current); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!draft || busy.current) return;
    busy.current = true; setSaving(true); setFormError("");
    try {
      const input = { calendarId, name: draft.name, endpoint: draft.endpoint, eventTypes: draft.eventTypes, idempotencyKey: draft.requestKey };
      if (draft.subscription) {
        await calendarCommand("updateCalendarSubscription", { ...input, subscriptionId: draft.subscription.id, expectedVersion: draft.subscription.version, status: draft.subscription.status === "paused" ? "paused" : "active" });
        if (alive.current) setDraft(undefined);
      } else {
        const saved = await calendarCommand("createCalendarSubscription", input);
        if (alive.current) { setSecret(saved.secret ?? ""); if (!saved.secret) { setDraft(undefined); toast.message(t("subscriptions.secretLost")); } }
      }
      if (alive.current) refresh();
    } catch (cause) { if (alive.current) setFormError((cause as Error).message); }
    finally { busy.current = false; if (alive.current) setSaving(false); }
  }
  async function pause(subscription: CalendarSubscription) {
    if (busy.current) return; busy.current = true; setSaving(true); setError("");
    try {
      await calendarCommand("updateCalendarSubscription", { calendarId, subscriptionId: subscription.id, name: subscription.name, endpoint: subscription.endpoint, eventTypes: subscription.eventTypes, status: subscription.status === "active" ? "paused" : "active", expectedVersion: subscription.version, idempotencyKey: crypto.randomUUID() });
      if (alive.current) refresh();
    } catch (cause) { if (alive.current) toast.error((cause as Error).message); }
    finally { busy.current = false; if (alive.current) setSaving(false); }
  }
  const create = <Button size="sm" disabled={calendar.archived || saving} onClick={() => edit()}><Plus data-icon="inline-start" />{t("subscriptions.create")}</Button>;
  return <div className="flex min-w-0 flex-col gap-4">
    {!!page?.items.length && <div className="flex flex-wrap items-center justify-end gap-2">{create}</div>}
    {loading ? <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p> : error ? <ListErrorState description={error} onRetry={refresh} /> : !page?.items.length ? <AppEmptyState density="compact" illustration={NOTIOLY.fastInternet} title={t("subscriptions.empty")} description={t("subscriptions.emptyHint")} action={create} /> : <ul className="divide-y border-y">
      {page.items.map(subscription => <li key={subscription.id} className="flex min-w-0 flex-col gap-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-words text-sm font-medium">{subscription.name}</span><Badge variant="secondary">{t(`subscriptions.status.${subscription.status}`)}</Badge></div>
        <p className="break-all text-xs text-muted-foreground">{subscription.endpoint}</p>
        <p className="break-words text-xs text-muted-foreground">{subscription.eventTypes.map(type => t(`subscriptions.events.${type.replaceAll(".", "_")}`)).join(" · ")}</p>
        <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => setViewing(subscription)}>{t("subscriptions.history")}</Button>{subscription.status !== "revoked" && <>
          <Button variant="outline" size="sm" disabled={saving} onClick={() => edit(subscription)}>{t("edit")}</Button>
          <Button variant="outline" size="sm" disabled={saving || calendar.archived && subscription.status === "paused"} onClick={() => void pause(subscription)}>{t(subscription.status === "active" ? "subscriptions.pause" : "subscriptions.resume")}</Button>
          <Button variant="outline" size="sm" disabled={saving} onClick={() => { setRotationError(""); setRotation(subscription); }}>{t("subscriptions.rotate")}</Button>
          <Button variant="destructive-ghost" size="sm" disabled={saving} onClick={() => setRevoking(subscription)}>{t("subscriptions.revoke")}</Button>
        </>}</div>
      </li>)}
    </ul>}
    {page && (cursors.length > 1 || page.hasMore) && <ListPagination page={cursors.length} hasNext={page.hasMore} loading={loading} onPageChange={next => setCursors(current => next < current.length ? current.slice(0, -1) : [...current, page.nextCursor ?? undefined])} />}
    <Dialog open={!!draft} onOpenChange={open => { if (!open && !busy.current) { setDraft(undefined); setSecret(""); } }}><DialogContent closeLabel={t("close")} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{t(secret ? "subscriptions.secretTitle" : draft?.subscription ? "subscriptions.edit" : "subscriptions.create")}</DialogTitle><DialogDescription>{t(secret ? "subscriptions.secretOnce" : "subscriptions.endpointHint")}</DialogDescription></DialogHeader>
      {secret ? <div className="flex flex-col gap-4"><Field><FieldLabel htmlFor={`${id}-secret`}>{t("subscriptions.secret")}</FieldLabel><Input id={`${id}-secret`} readOnly autoComplete="off" spellCheck={false} value={secret} onFocus={event => event.currentTarget.select()} /></Field><Button variant="outline" onClick={() => { void navigator.clipboard.writeText(secret).then(() => toast.success(t("subscriptions.copied")), () => toast.error(t("subscriptions.copyFailed"))); }}><Copy data-icon="inline-start" />{t("subscriptions.copy")}</Button></div> : <form noValidate className="flex flex-col gap-5" onSubmit={save}><FieldGroup>
        <Field><FieldLabel htmlFor={`${id}-name`}>{t("name")}</FieldLabel><Input id={`${id}-name`} required maxLength={200} disabled={saving} value={draft?.name ?? ""} onChange={event => change({ name: event.target.value })} /></Field>
        <Field><FieldLabel htmlFor={`${id}-endpoint`}>{t("subscriptions.endpoint")}</FieldLabel><Input id={`${id}-endpoint`} required type="url" maxLength={2000} placeholder="https://example.com/events" disabled={saving} value={draft?.endpoint ?? ""} onChange={event => change({ endpoint: event.target.value })} /><FieldDescription>{t("subscriptions.endpointHint")}</FieldDescription></Field>
        <FieldSet><FieldLegend variant="label">{t("subscriptions.eventTypes")}</FieldLegend><div className="grid gap-2 sm:grid-cols-2">{CALENDAR_EVENT_TYPES.map(type => <label key={type} className="flex min-h-8 items-center gap-2 text-sm"><Checkbox disabled={saving} checked={draft?.eventTypes.includes(type) ?? false} onCheckedChange={checked => change({ eventTypes: checked ? [...draft!.eventTypes, type] : draft!.eventTypes.filter(item => item !== type) })} />{t(`subscriptions.events.${type.replaceAll(".", "_")}`)}</label>)}</div><FieldDescription>{t("subscriptions.boundary")}</FieldDescription></FieldSet>
      </FieldGroup>{formError && <FieldError role="alert">{formError}</FieldError>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={() => setDraft(undefined)}>{t("close")}</Button><Button disabled={saving || !draft?.name.trim() || !draft.endpoint.trim() || !draft.eventTypes.length}>{saving && <LoaderCircle className="animate-spin" data-icon="inline-start" />}{t(saving ? "saving" : "save")}</Button></div></form>}
    </DialogContent></Dialog>
    <DeleteConfirmation open={!!revoking} onOpenChange={open => { if (!open) setRevoking(undefined); }} title={t("subscriptions.revoke")} description={t("subscriptions.revokeHint")} labels={{ confirmDelete: t("subscriptions.revoke") }} onConfirm={async () => { if (!revoking) return; await calendarCommand("revokeCalendarSubscription", { calendarId, subscriptionId: revoking.id, expectedVersion: revoking.version, idempotencyKey: crypto.randomUUID() }); refresh(); }} />
    <Dialog open={!!rotation} onOpenChange={open => { if (!open && !busy.current) setRotation(undefined); }}><DialogContent closeLabel={t("close")}><DialogHeader><DialogTitle>{t("subscriptions.rotate")}</DialogTitle><DialogDescription>{t("subscriptions.rotateHint")}</DialogDescription></DialogHeader>
      {rotationError && <FieldError role="alert">{rotationError}</FieldError>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={() => setRotation(undefined)}>{t("close")}</Button><Button disabled={saving} onClick={() => {
        if (!rotation || busy.current) return; busy.current = true; setSaving(true); setRotationError("");
        void calendarCommand("rotateCalendarSubscriptionSecret", { calendarId, subscriptionId: rotation.id, expectedVersion: rotation.version, idempotencyKey: crypto.randomUUID() }).then(saved => {
          if (!alive.current) return;
          setRotation(undefined); edit(saved.subscription); setSecret(saved.secret ?? ""); refresh();
        }).catch(cause => { if (alive.current) setRotationError(cause.message); }).finally(() => { busy.current = false; if (alive.current) setSaving(false); });
      }}>{t(saving ? "saving" : "subscriptions.rotate")}</Button></div>
    </DialogContent></Dialog>
    {viewing && <CalendarDeliveryHistory key={viewing.id} subscription={viewing} open onClose={() => setViewing(undefined)} />}
  </div>;
}
