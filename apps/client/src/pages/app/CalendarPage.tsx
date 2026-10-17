import { ScheduledOccurrenceSheet } from "@/components/calendar/ScheduledOccurrenceSheet";
import { Switch } from "@tabdo/ui/components/switch";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import FullCalendar, { type CalendarRef, type DatesSetInfo, type EventDropInfo, type EventResizeDoneInfo } from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import listPlugin from "@fullcalendar/react/list";
import interactionPlugin from "@fullcalendar/react/interaction";
import themePlugin from "@fullcalendar/react/themes/monarch";
import zhLocale from "@fullcalendar/react/locales/zh-cn";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/monarch/theme.css";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw, Settings } from "lucide-react";
import type { Booking, Calendar, CalendarPerson, CalendarResults, ScheduledOccurrence } from "@tabdo/shared";
import { api } from "@/lib/api";
import { calendarCommand } from "@/lib/calendar-api";
import { wallTimeOptions } from "@/components/calendar/calendar-time";
import { BookingSheet } from "@/components/calendar/BookingSheet";
import { CalendarEditor, CalendarManagement } from "@/components/calendar/CalendarManagement";
import { AppPageHeader } from "@/components/shell/AppPage";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { DeleteConfirmation } from "@/components/controls/delete-confirmation";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Field, FieldLabel, FieldError } from "@tabdo/ui/components/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@tabdo/ui/components/select";
import { ToggleGroup, ToggleGroupItem } from "@tabdo/ui/components/toggle-group";
import { Separator } from "@tabdo/ui/components/separator";

const plugins = [themePlugin, dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin];
type Draft = { booking?: Booking; start: string; duration: number; error?: string };
export function CalendarPage() {
  const { t, i18n } = useTranslation("calendar");
  const narrow = useMediaQuery("(max-width: 767px)");
  const [calendars, setCalendars] = useState<Calendar[]>([]), [calendarId, setCalendarId] = useState("");
  const [people, setPeople] = useState<CalendarPerson[]>([]), [personId, setPersonId] = useState("all"), [bookings, setBookings] = useState<Booking[]>([]);
  const [range, setRange] = useState<{ rangeStart: string; rangeEnd: string }>(), [view, setView] = useState(narrow ? "listWeek" : "timeGridWeek"), [viewTitle, setViewTitle] = useState("");
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [canManage, setCanManage] = useState(false), [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<"new" | "edit" | null>(null), [manage, setManage] = useState(false), [archive, setArchive] = useState(false), [draft, setDraft] = useState<Draft>();
  const [pending, setPending] = useState(false), [duration, setDuration] = useState(30), [availability, setAvailability] = useState<CalendarResults["queryAvailability"]>(), [slotCount, setSlotCount] = useState(50);
  const [showPlans, setShowPlans] = useState(false), [plans, setPlans] = useState<ScheduledOccurrence[]>([]), [planError, setPlanError] = useState(""), [selectedPlan, setSelectedPlan] = useState<ScheduledOccurrence>();
  const calendarRef = useRef<CalendarRef>(null), busy = useRef(false);
  useEffect(() => { if (narrow) { setView("listWeek"); calendarRef.current?.getApi().changeView("listWeek"); } }, [narrow]);
  const calendar = calendars.find(item => item.id === calendarId);
  const selectedPerson = people.find(item => item.id === personId);
  const zone = selectedPerson?.timeZone ?? calendar?.timeZone ?? "UTC";
  const loadDirectory = useCallback(async () => {
    const result = await calendarCommand("listCalendars", {});
    setCalendars(result.items);
    setCalendarId(current => result.items.some(item => item.id === current) ? current : result.items[0]?.id ?? "");
    if (calendarId && result.items.some(item => item.id === calendarId)) setPeople((await calendarCommand("listCalendarPeople", { calendarId })).items);
  }, [calendarId]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    void Promise.all([calendarCommand("listCalendars", {}, controller.signal), api.listMembers()]).then(([result, members]) => {
      if (controller.signal.aborted) return;
      setCalendars(result.items); setCalendarId(current => result.items.some(item => item.id === current) ? current : result.items[0]?.id ?? "");
      setCanManage(["owner", "admin"].includes(members.actor?.role ?? ""));
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const controller = new AbortController(); setPeople([]); setPersonId("all"); setAvailability(undefined);
    if (calendarId) void calendarCommand("listCalendarPeople", { calendarId }, controller.signal).then(result => setPeople(result.items)).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [calendarId]);
  const loadBookings = useCallback(async (signal?: AbortSignal) => {
    if (!calendarId || !range) return;
    const result = await calendarCommand("queryBookings", { calendarId, ...range, ...(personId === "all" ? {} : { personId }) }, signal);
    setBookings(result.items);
  }, [calendarId, personId, range]);
  useEffect(() => {
    const controller = new AbortController(); setError(""); setAvailability(undefined);
    void loadBookings(controller.signal).catch(cause => { if (!controller.signal.aborted) { setBookings([]); setError(cause.message); } });
    return () => controller.abort();
  }, [loadBookings, revision]);
  useEffect(() => {
    const controller = new AbortController(); setPlans([]); setPlanError("");
    if (showPlans && range) void calendarCommand("queryScheduledOccurrences", { ...range, limit: 1000 }, controller.signal).then(result => { if (!controller.signal.aborted) setPlans(result.items); }).catch(cause => { if (!controller.signal.aborted) setPlanError(cause.message); });
    return () => controller.abort();
  }, [showPlans, range, revision]);
  const saved = async () => { await loadDirectory(); await loadBookings(); setAvailability(undefined); };
  const datesSet = useCallback((info: DatesSetInfo) => {
    const rangeStart = info.start.toISOString(), rangeEnd = info.end.toISOString();
    setRange(current => current?.rangeStart === rangeStart && current.rangeEnd === rangeEnd ? current : { rangeStart, rangeEnd }); setViewTitle(info.view.title);
  }, []);
  const events = useMemo(() => [...bookings.map(item => ({ id: item.id, title: `${people.find(person => person.id === item.personId)?.name ?? ""} · ${item.title}`, start: item.start, end: item.end, allDay: false })), ...plans.map((item, index) => ({ id: `plan:${index}`, title: `${t(`plans.${item.projection}`)} · ${item.name}`, start: item.scheduledFor, allDay: false, editable: false, durationEditable: false, display: "list-item", color: "var(--muted-foreground)", classNames: ["tabdo-schedule-point"] }))], [bookings, people, plans, t]);
  function startDraft(start: string, allDay = false, minutes = duration) {
    const point = allDay ? wallTimeOptions(start.slice(0, 10), "09:00", zone)[0]?.start : start;
    if (point) setDraft({ start: point, duration: minutes });
  }
  async function move(info: EventDropInfo | EventResizeDoneInfo) {
    const booking = bookings.find(item => item.id === info.event.id), start = info.event.start?.toISOString(), end = info.event.end?.toISOString();
    if (busy.current || !booking || !start || !end || info.event.allDay) { info.revert(); return; }
    busy.current = true; setPending(true); setError("");
    try { await calendarCommand("rescheduleBooking", { calendarId, bookingId: booking.id, expectedVersion: booking.version, time: { start, end, timeZone: booking.timeZone }, idempotencyKey: crypto.randomUUID() }); await saved(); }
    catch (cause) { info.revert(); const message = cause instanceof Error ? cause.message : t("errors.REQUEST_FAILED"); setError(message); setDraft({ booking, start, duration: (Date.parse(end) - Date.parse(start)) / 60000, error: message }); }
    finally { busy.current = false; setPending(false); }
  }
  return <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col" data-testid="calendar-workspace">
    <AppPageHeader page="calendar" description={t("description")} className="py-4">
      <Button variant="ghost" size="icon" aria-label={t("refresh")} disabled={loading || pending} onClick={() => setRevision(value => value + 1)}><RefreshCw /></Button>
      {canManage && <Button variant="outline" size="sm" onClick={() => setEditor("new")}><Plus data-icon="inline-start" />{t("newCalendar")}</Button>}
      {calendar && <Button size="sm" disabled={!people.length || pending} onClick={() => startDraft(new Date(Math.ceil(Date.now() / 1800000) * 1800000).toISOString())}><Plus data-icon="inline-start" />{t("newBooking")}</Button>}
    </AppPageHeader>
    <div className="flex items-center gap-2 border-b px-4 py-2"><Switch id="calendar-plans" checked={showPlans} onCheckedChange={setShowPlans} /><FieldLabel htmlFor="calendar-plans">{t("plans.overlay")}</FieldLabel><span className="hidden text-xs text-muted-foreground md:inline">{t("plans.legend")}</span></div>
    {loading ? <p className="p-6 text-sm text-muted-foreground" role="status">{t("loading")}</p> : !calendar && !showPlans && !error ? <AppEmptyState illustration={NOTIOLY.fastInternet} title={t("emptyTitle")} description={t("emptyHint")} action={canManage && <Button onClick={() => setEditor("new")}>{t("newCalendar")}</Button>} /> : <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto p-3 md:p-5">
      {planError && <ListErrorState className="min-h-0 py-3" description={planError} onRetry={() => setRevision(value => value + 1)} />}
      {error && <ListErrorState className="min-h-0 py-3" description={error} onRetry={() => setRevision(value => value + 1)} />}
      {(calendar || showPlans) && <>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {calendar && <Select value={calendarId} onValueChange={setCalendarId} disabled={pending}><SelectTrigger className="w-44" aria-label={t("calendar")}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{calendars.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent></Select>}
          {calendar && <Select value={personId} onValueChange={setPersonId} disabled={pending}><SelectTrigger className="w-40" aria-label={t("person")}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">{t("allPeople")}</SelectItem>{people.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent></Select>}
          <span className="text-xs text-muted-foreground">{zone}</span>
          {canManage && calendar && <div className="flex flex-wrap gap-1 md:ml-auto"><Button variant="ghost" size="sm" onClick={() => setManage(true)}><Settings data-icon="inline-start" />{t("manage")}</Button><Button variant="ghost" size="sm" onClick={() => setEditor("edit")}>{t("editCalendar")}</Button><Button variant="destructive-ghost" size="sm" onClick={() => setArchive(true)}>{t("archiveCalendar")}</Button></div>}
        </div>
        {calendar && !people.length && <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><span>{t("noPeople")}</span>{canManage && <Button variant="outline" size="sm" onClick={() => setManage(true)}>{t("newPerson")}</Button>}</div>}
        <div className="mb-3 flex flex-wrap items-center gap-2"><div className="flex items-center gap-1"><Button variant="outline" size="icon" aria-label={t("previous")} onClick={() => calendarRef.current?.getApi().prev()}><ChevronLeft /></Button><Button variant="outline" size="icon" aria-label={t("next")} onClick={() => calendarRef.current?.getApi().next()}><ChevronRight /></Button><Button variant="outline" size="sm" onClick={() => calendarRef.current?.getApi().today()}>{t("today")}</Button></div><h2 className="min-w-0 text-sm font-medium">{viewTitle}</h2><ToggleGroup type="single" value={view} onValueChange={value => { if (value) { setView(value); calendarRef.current?.getApi().changeView(value); } }} className="md:ml-auto">{["timeGridDay", "timeGridWeek", "dayGridMonth", "listWeek"].map(value => <ToggleGroupItem key={value} value={value} aria-label={t(`views.${value}`)}>{t(`views.${value}`)}</ToggleGroupItem>)}</ToggleGroup></div>
        <div className="tabdo-booking-calendar min-h-[30rem] min-w-0 flex-1" aria-busy={pending}>
          <FullCalendar ref={calendarRef} plugins={plugins} initialView={view} locale={i18n.language.startsWith("zh") ? zhLocale : "en"} timeZone={zone} headerToolbar={false} datesSet={datesSet} events={events} defaultTimedEventDuration="00:00:01" editable={!pending && !error} selectable={!pending && people.length > 0} allDaySlot={false} eventDurationEditable eventDidMount={info => { if (!info.event.id.startsWith("plan:")) info.el.dataset.bookingId = info.event.id; else info.el.dataset.schedulePoint = info.event.id; }} slotDuration="00:30:00" height="100%" scrollTime="08:00:00" nowIndicator
            eventDrop={info => void move(info)} eventResize={info => void move(info)} eventClick={info => { if (info.event.id.startsWith("plan:")) { setSelectedPlan(plans[Number(info.event.id.slice(5))]); return; } const booking = bookings.find(item => item.id === info.event.id); if (booking) setDraft({ booking, start: booking.start, duration: (+new Date(booking.end) - +new Date(booking.start)) / 60000 }); }}
            select={info => { startDraft(info.startStr, info.allDay, info.allDay ? duration : Math.min(1440, Math.max(1, (+info.end - +info.start) / 60000))); calendarRef.current?.getApi().unselect(); }} />
        </div>
        {calendar && <>
        <Separator className="my-4" />
        <div className="flex flex-wrap items-end gap-3"><Field className="w-28"><FieldLabel htmlFor="calendar-duration">{t("duration")}</FieldLabel><Input id="calendar-duration" type="number" min={1} max={1440} value={duration} onChange={e => { setDuration(Number(e.target.value)); setAvailability(undefined); }} /></Field><Button variant="outline" disabled={!selectedPerson || pending || duration < 1 || duration > 1440} onClick={async () => {
          if (!selectedPerson || busy.current) return; busy.current = true; setPending(true); setError("");
          try { const rangeStart = new Date(Math.ceil(Date.now() / 60000) * 60000).toISOString(); setAvailability(await calendarCommand("queryAvailability", { calendarId, personId, rangeStart, rangeEnd: new Date(Date.parse(rangeStart) + 7 * 86400000).toISOString(), durationMinutes: duration })); setSlotCount(50); }
          catch (cause) { setError(cause instanceof Error ? cause.message : t("errors.REQUEST_FAILED")); } finally { busy.current = false; setPending(false); }
        }}><CalendarDays data-icon="inline-start" />{t("findAvailability")}</Button><p className="text-xs text-muted-foreground">{t(selectedPerson ? "availabilityHint" : "selectPersonHint")}</p></div>
        {availability && <div className="mt-4 flex flex-col gap-3"><p role="status" className="text-sm">{t("slotCount", { count: availability.slots.length })}</p><div className="flex flex-wrap gap-2">{availability.slots.slice(0, slotCount).map(slot => <Button key={slot.start} variant="outline" size="sm" onClick={() => startDraft(slot.start)}>{new Intl.DateTimeFormat(i18n.language, { timeZone: zone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" }).format(new Date(slot.start))}</Button>)}</div>{slotCount < availability.slots.length && <Button variant="ghost" onClick={() => setSlotCount(count => count + 50)}>{t("moreSlots")}</Button>}</div>}
        </>}
      </>}
    </div>}
    {selectedPlan && <ScheduledOccurrenceSheet occurrence={selectedPlan} onClose={() => setSelectedPlan(undefined)} onSaved={() => setRevision(value => value + 1)} />}
    {editor && <CalendarEditor calendar={editor === "edit" ? calendar : undefined} onClose={() => setEditor(null)} onSaved={async savedCalendar => { await loadDirectory(); setCalendarId(savedCalendar.id); }} />}
    {manage && calendar && <CalendarManagement calendar={calendar} people={people} onClose={() => setManage(false)} onSaved={saved} />}
    {draft && calendar && <BookingSheet calendarId={calendarId} people={people} personId={selectedPerson?.id} start={draft.start} duration={draft.duration} booking={draft.booking} initialError={draft.error} onClose={() => setDraft(undefined)} onSaved={saved} />}
    {calendar && <DeleteConfirmation open={archive} onOpenChange={setArchive} labels={{ confirmDelete: t("confirmArchive"), deleting: t("archiving") }} title={t("archiveCalendar")} description={t("archiveHint")} onConfirm={async () => { await calendarCommand("archiveCalendar", { calendarId, expectedVersion: calendar.version, idempotencyKey: `archive:${calendarId}:${calendar.version}` }); await loadDirectory(); }} />}
  </div>;
}
