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
import { ChevronLeft, ChevronRight, PanelLeft, Plus, RefreshCw } from "lucide-react";
import type { Booking, Calendar, CalendarPerson, CalendarMember, ScheduledOccurrence } from "@tabdo/shared";
import { api } from "@/lib/api";
import { calendarCommand } from "@/lib/calendar-api";
import { wallTimeOptions } from "@/components/calendar/calendar-time";
import { BookingDialog } from "@/components/calendar/BookingDialog";
import { CalendarEditor } from "@/components/calendar/CalendarEditor";
import { CalendarSidebar } from "@/components/calendar/CalendarSidebar";
import { ScheduledOccurrenceSheet } from "@/components/calendar/ScheduledOccurrenceSheet";
import { AppPageHeader } from "@/components/shell/AppPage";
import { ListErrorState } from "@/components/shell/ListErrorState";
import { AppEmptyState } from "@/components/shell/AppEmptyState";
import { NOTIOLY } from "@/components/illustrations/NotiolyImage";
import { DeleteConfirmation } from "@/components/controls/delete-confirmation";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Button } from "@tabdo/ui/components/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@tabdo/ui/components/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@tabdo/ui/components/sheet";
import { Skeleton } from "@tabdo/ui/components/skeleton";

const plugins = [themePlugin, dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin];
const views = ["timeGridDay", "timeGridWeek", "dayGridMonth", "listWeek"];
const viewKey = "tabdo.calendar.view";
function initialRange() {
  const now = new Date(), start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 7 * 86400000), end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) + 7 * 86400000);
  return { rangeStart: start.toISOString(), rangeEnd: end.toISOString() };
}
type Draft = { booking?: Booking; start: string; duration: number; error?: string };
type Management = { kind: "edit" | "archive"; calendar: Calendar } | { kind: "new" };
function savedView() {
  try { const stored = localStorage.getItem(viewKey); if (stored && views.includes(stored)) return stored; } catch { /* Storage can be unavailable. */ }
}
export function CalendarPage() {
  const { t, i18n } = useTranslation("calendar");
  const narrow = useMediaQuery("(max-width: 767px)");
  const [calendars, setCalendars] = useState<Calendar[]>([]), [calendarId, setCalendarId] = useState("");
  const [members, setMembers] = useState<CalendarMember[]>([]);
  const [people, setPeople] = useState<CalendarPerson[]>([]), [personId, setPersonId] = useState("all"), [bookings, setBookings] = useState<Booking[]>([]);
  const [range, setRange] = useState<{ rangeStart: string; rangeEnd: string }>(initialRange), [view, setView] = useState(savedView), [viewTitle, setViewTitle] = useState(""), [visibleRange, setVisibleRange] = useState<{ start: Date; end: Date }>();
  const [loading, setLoading] = useState(true), [peopleLoading, setPeopleLoading] = useState(false), [bookingsLoading, setBookingsLoading] = useState(false);
  const [error, setError] = useState(""), [peopleError, setPeopleError] = useState(""), [canManage, setCanManage] = useState(false), [revision, setRevision] = useState(0);
  const [management, setManagement] = useState<Management>(), [draft, setDraft] = useState<Draft>(), [pending, setPending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true), [mobileList, setMobileList] = useState(false);
  const [plans, setPlans] = useState<ScheduledOccurrence[]>([]), [planError, setPlanError] = useState(""), [selectedPlan, setSelectedPlan] = useState<ScheduledOccurrence>();
  const calendarRef = useRef<CalendarRef>(null), busy = useRef(false), activeId = useRef(calendarId), focusReturn = useRef<HTMLElement | null>(null), listTrigger = useRef<HTMLButtonElement>(null);
  activeId.current = calendarId;
  const calendar = calendars.find(item => item.id === calendarId);
  const zone = calendar?.timeZone ?? "UTC";
  const draftOpen = useRef(false);
  // Only automatic defaults follow the viewport; an explicit choice takes precedence.
  const effectiveView = view ?? (narrow ? "listWeek" : "dayGridMonth");
  useEffect(() => { calendarRef.current?.getApi().changeView(effectiveView); }, [effectiveView]);
  // Overlays opened from a menu have no Radix Trigger; restore focus to the originating control.
  const overlayOpen = !!(management || draft || selectedPlan);
  useEffect(() => {
    if (!overlayOpen) return;
    const origin = focusReturn.current;
    return () => { requestAnimationFrame(() => { if (origin?.isConnected) origin.focus(); else listTrigger.current?.focus(); }); };
  }, [overlayOpen]);
  function rememberFocus() { const element = document.activeElement; if (element instanceof HTMLElement && !element.closest("[role=menu]")) focusReturn.current = element; }
  function chooseCalendar(id: string) {
    if (id === activeId.current) return;
    activeId.current = id; setCalendarId(id); setPeople([]); setMembers([]); setPersonId("all"); setBookings([]); setPeopleError(""); setError(""); setPeopleLoading(!!id);
  }
  const loadDirectory = async () => {
    const result = await calendarCommand("listCalendars", {});
    setCalendars(result.items);
    if (!result.items.some(item => item.id === activeId.current)) chooseCalendar(result.items[0]?.id ?? "");
  };
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([calendarCommand("listCalendars", {}, controller.signal), api.listMembers()]).then(([result, members]) => {
      if (controller.signal.aborted) return;
      setCalendars(result.items);
      if (!result.items.some(item => item.id === activeId.current)) chooseCalendar(result.items[0]?.id ?? "");
      setCanManage(["owner", "admin"].includes(members.actor?.role ?? ""));
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const controller = new AbortController(); setPeopleLoading(!!calendarId); setPeopleError("");
    if (calendarId) void Promise.all([calendarCommand("listCalendarMembers", { calendarId }, controller.signal), calendarCommand("listCalendarPeople", { calendarId }, controller.signal)]).then(([directory, legacy]) => { if (!controller.signal.aborted && activeId.current === calendarId) { setMembers(directory.items); setPeople(legacy.items); } }).catch(cause => { if (!controller.signal.aborted) setPeopleError(cause.message); }).finally(() => { if (!controller.signal.aborted) setPeopleLoading(false); });
    return () => controller.abort();
  }, [calendarId, revision]);
  const loadBookings = useCallback(async (signal?: AbortSignal) => {
    if (!calendarId || !range) return;
    const result = await calendarCommand("queryBookings", { calendarId, ...range, ...(personId === "all" ? {} : { userId: personId }) }, signal);
    if (!signal?.aborted && activeId.current === calendarId) setBookings(result.items);
  }, [calendarId, personId, range]);
  useEffect(() => {
    const controller = new AbortController(); setError(""); setBookings([]); setBookingsLoading(!!calendarId && !!range);
    void loadBookings(controller.signal).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setBookingsLoading(false); });
    return () => controller.abort();
  }, [loadBookings, revision]);
  useEffect(() => {
    const controller = new AbortController(); setPlans([]); setPlanError("");
    if (range) void calendarCommand("queryScheduledOccurrences", { ...range, limit: 1000 }, controller.signal).then(result => { if (!controller.signal.aborted) setPlans(result.items); }).catch(cause => { if (!controller.signal.aborted) setPlanError(cause.message); });
    return () => controller.abort();
  }, [range, revision]);
  const saved = async () => {
    const id = activeId.current;
    await loadDirectory();
    if (id && activeId.current === id) { const [directory, legacy] = await Promise.all([calendarCommand("listCalendarMembers", { calendarId: id }), calendarCommand("listCalendarPeople", { calendarId: id })]); if (activeId.current === id) { setMembers(directory.items); setPeople(legacy.items); } }
    await loadBookings();
  };
  const datesSet = useCallback((info: DatesSetInfo) => {
    const rangeStart = info.start.toISOString(), rangeEnd = info.end.toISOString();
    setRange(current => current?.rangeStart === rangeStart && current.rangeEnd === rangeEnd ? current : { rangeStart, rangeEnd }); setViewTitle(info.view.title); setVisibleRange({ start: info.view.currentStart, end: new Date(+info.view.currentEnd - 1) });
  }, []);
  const events = useMemo(() => [...bookings.map(item => ({ id: item.id, title: item.title, start: item.start, end: item.end, allDay: false, extendedProps: { person: members.find(member => member.userId === item.userId)?.name ?? people.find(person => person.id === item.personId)?.name }, color: "var(--accent)", contrastColor: "var(--accent-foreground)", className: "tabdo-booking-event" })), ...plans.map((item, index) => ({ id: `plan:${index}`, title: `${t(`plans.${item.projection}`)} · ${item.name}${item.status ? ` · ${t(`reminders.status.${item.status}`, { defaultValue: item.status })}` : ""}`, start: item.scheduledFor, allDay: false, editable: false, durationEditable: false, color: "var(--muted)", contrastColor: "var(--foreground)", className: "tabdo-schedule-point" }))], [bookings, members, people, plans, t]);
  function startDraft(start: string, allDay = false, minutes = 30) {
    if (!calendar || pending || peopleLoading || peopleError || error || draftOpen.current || !members.length) return;
    rememberFocus();
    const point = allDay ? wallTimeOptions(start.slice(0, 10), "09:00", zone)[0]?.start : start;
    if (point) { draftOpen.current = true; setDraft({ start: point, duration: minutes }); }
  }
  async function move(info: EventDropInfo | EventResizeDoneInfo) {
    const booking = bookings.find(item => item.id === info.event.id), start = info.event.start?.toISOString(), end = info.event.end?.toISOString();
    if (busy.current || !booking || !start || !end || info.event.allDay) { info.revert(); return; }
    busy.current = true; setPending(true); setError("");
    try { await calendarCommand("rescheduleBooking", { calendarId, bookingId: booking.id, expectedVersion: booking.version, time: { start, end, timeZone: booking.timeZone }, idempotencyKey: crypto.randomUUID() }); await saved(); }
    catch (cause) { info.revert(); const message = cause instanceof Error ? cause.message : t("errors.REQUEST_FAILED"); setError(message); rememberFocus(); setDraft({ booking, start, duration: (Date.parse(end) - Date.parse(start)) / 60000, error: message }); }
    finally { busy.current = false; setPending(false); }
  }
  const sidebar = <CalendarSidebar calendars={calendars} calendarId={calendarId} canManage={canManage} disabled={pending || overlayOpen} onFocusReturn={element => { focusReturn.current = element; }} onSelect={item => { chooseCalendar(item.id); setMobileList(false); }} onCreate={() => { rememberFocus(); setMobileList(false); setManagement({ kind: "new" }); }} onEdit={item => { rememberFocus(); setMobileList(false); setManagement({ kind: "edit", calendar: item }); }} onArchive={item => { rememberFocus(); setMobileList(false); setManagement({ kind: "archive", calendar: item }); }} />;
  const dateRange = visibleRange && new Intl.DateTimeFormat(i18n.language, { timeZone: zone, year: "numeric", month: "short", day: "numeric" }).formatRange(visibleRange.start, visibleRange.end);
  const displayZone = new Intl.DateTimeFormat(i18n.language, { timeZone: zone, timeZoneName: "long" }).formatToParts(new Date()).find(part => part.type === "timeZoneName")?.value;
  return <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col" data-testid="calendar-workspace">
    <AppPageHeader page="calendar" className="py-4" />
    <div className="flex min-h-0 min-w-0 flex-1">
      {!narrow && sidebarOpen && <aside className="w-48 shrink-0 overflow-y-auto border-r" aria-label={t("calendarList")}>{sidebar}</aside>}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        <div className="flex flex-wrap items-center gap-3 border-b px-3 py-3 md:px-5" data-testid="calendar-toolbar">
          <Button ref={listTrigger} variant="ghost" size="icon" aria-label={t(narrow ? "calendarList" : sidebarOpen ? "hideCalendars" : "showCalendars")} aria-expanded={narrow ? mobileList : sidebarOpen} onClick={() => narrow ? setMobileList(true) : setSidebarOpen(value => !value)}><PanelLeft /></Button>
          <div className="min-w-0 flex-1 basis-3/4 md:basis-auto"><h2 className="text-base font-semibold">{viewTitle}</h2><p className="hidden text-xs text-muted-foreground md:block">{dateRange}</p></div>
          <div className="flex items-center gap-1"><Button variant="outline" size="icon" aria-label={t("previous")} onClick={() => calendarRef.current?.getApi().prev()}><ChevronLeft /></Button><Button variant="outline" size="sm" onClick={() => calendarRef.current?.getApi().today()}>{t("today")}</Button><Button variant="outline" size="icon" aria-label={t("next")} onClick={() => calendarRef.current?.getApi().next()}><ChevronRight /></Button></div>
          <Select value={effectiveView} onValueChange={value => { setView(value); try { localStorage.setItem(viewKey, value); } catch { /* Keep the in-memory preference. */ } calendarRef.current?.getApi().changeView(value); }}><SelectTrigger className="w-24" aria-label={t("view")}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{views.map(value => <SelectItem key={value} value={value}>{t(`views.${value}`)}</SelectItem>)}</SelectGroup></SelectContent></Select>
          {calendar && <Button size="sm" disabled={pending || peopleLoading || !!peopleError || !!error} onClick={() => startDraft(new Date(Math.ceil(Date.now() / 1800000) * 1800000).toISOString())}><Plus data-icon="inline-start" />{t("newBooking")}</Button>}
          <Button variant="ghost" size="icon" aria-label={t("refresh")} disabled={loading || pending} onClick={() => setRevision(value => value + 1)}><RefreshCw /></Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 md:px-5">
          {calendar && <span className="max-w-48 truncate text-sm font-medium">{calendar.name}</span>}
          {members.length > 0 && <Select value={personId} onValueChange={value => { setBookings([]); setPersonId(value); }} disabled={pending || peopleLoading}><SelectTrigger className="w-36" aria-label={t("person")}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">{t("allPeople")}</SelectItem>{members.map(item => <SelectItem key={item.userId} value={item.userId}>{item.name} · {t(`memberKind.${item.kind}`)} · {item.userId}</SelectItem>)}</SelectGroup></SelectContent></Select>}
          <span className="text-xs text-muted-foreground">{displayZone}</span>
          {(loading || peopleLoading || bookingsLoading) && <span role="status" className="text-xs text-muted-foreground">{t("loading")}</span>}
        </div>
        {(error || peopleError) && <ListErrorState className="min-h-0 py-3" description={error || peopleError} onRetry={() => setRevision(value => value + 1)} />}
        {planError && <ListErrorState className="min-h-0 py-3" description={planError} onRetry={() => setRevision(value => value + 1)} />}
        {loading ? <Skeleton className="m-3 min-h-80" /> : !calendar && !plans.length && !error && !planError ? <AppEmptyState illustration={NOTIOLY.fastInternet} title={t("emptyTitle")} description={t("emptyHint")} action={canManage && <Button onClick={() => { rememberFocus(); setManagement({ kind: "new" }); }}>{t("newCalendar")}</Button>} /> : <div className="tabdo-booking-calendar min-h-[30rem] min-w-0 flex-1 px-3 pb-3 md:px-5 md:pb-5" aria-busy={pending || bookingsLoading}>
          <FullCalendar ref={calendarRef} plugins={plugins} initialView={effectiveView} locale={i18n.language.startsWith("zh") ? zhLocale : "en"} timeZone={zone} headerToolbar={false} datesSet={datesSet} events={events} defaultTimedEventDuration="00:00:01" editable={!pending && !error && !bookingsLoading} selectable={!pending && !peopleLoading && !peopleError && members.length > 0 && !!calendar} selectMinDistance={5} allDaySlot={false} eventDurationEditable dayMaxEvents={3} moreLinkText={count => t("moreEvents", { count })} moreLinkClick="popover" eventDisplay="block" dayCellClass={info => info.isOther ? "tabdo-other-month" : ""} eventContent={info => <span className="tabdo-event-content"><span className="tabdo-event-title">{info.event.title}</span><span className="tabdo-event-time">{info.timeText}</span></span>} eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }} eventDidMount={info => { if (!info.event.id.startsWith("plan:")) { info.el.dataset.bookingId = info.event.id; info.el.title = `${info.event.title} · ${info.event.extendedProps.person ?? ""}`; } else info.el.dataset.schedulePoint = info.event.id; }} slotDuration="00:30:00" height="100%" scrollTime="08:00:00" nowIndicator
            eventDrop={info => void move(info)} eventResize={info => void move(info)} eventClick={info => { rememberFocus(); if (info.event.id.startsWith("plan:")) { setSelectedPlan(plans[Number(info.event.id.slice(5))]); return; } const booking = bookings.find(item => item.id === info.event.id); if (booking) setDraft({ booking, start: booking.start, duration: (+new Date(booking.end) - +new Date(booking.start)) / 60000 }); }}
            dateClick={info => startDraft(info.dateStr, info.allDay)}
            select={info => { startDraft(info.startStr, info.allDay, info.allDay ? 30 : Math.min(1440, Math.max(1, (+info.end - +info.start) / 60000))); calendarRef.current?.getApi().unselect(); }} />
        </div>}
      </main>
    </div>
    <Sheet open={mobileList} onOpenChange={setMobileList}><SheetContent className="overflow-y-auto" onCloseAutoFocus={event => { event.preventDefault(); listTrigger.current?.focus(); }}><SheetHeader><SheetTitle>{t("calendarList")}</SheetTitle><SheetDescription>{t("chooseCalendar")}</SheetDescription><Button variant="ghost" size="sm" onClick={() => setMobileList(false)}>{t("close")}</Button></SheetHeader>{sidebar}</SheetContent></Sheet>
    {selectedPlan && <ScheduledOccurrenceSheet occurrence={selectedPlan} onClose={() => setSelectedPlan(undefined)} onSaved={() => setRevision(value => value + 1)} />}
    {(management?.kind === "new" || management?.kind === "edit") && <CalendarEditor calendar={management.kind === "edit" ? management.calendar : undefined} onClose={() => setManagement(undefined)} onSaved={async savedCalendar => { await loadDirectory(); if (management.kind === "new") chooseCalendar(savedCalendar.id); }} />}
    {draft && calendar && <BookingDialog calendarId={calendarId} people={people} members={members} userId={personId === "all" ? undefined : personId} timeZone={zone} start={draft.start} duration={draft.duration} booking={draft.booking} initialError={draft.error} onClose={() => { draftOpen.current = false; setDraft(undefined); }} onSaved={saved} />}
    {management?.kind === "archive" && <DeleteConfirmation open onOpenChange={open => { if (!open) setManagement(undefined); }} labels={{ confirmDelete: t("confirmArchive"), deleting: t("archiving") }} title={t("archiveTarget", { name: management.calendar.name })} description={t("archiveHint")} onConfirm={async () => { const item = management.calendar; await calendarCommand("archiveCalendar", { calendarId: item.id, expectedVersion: item.version, idempotencyKey: `archive:${item.id}:${item.version}` }); await loadDirectory(); }} />}
  </div>;
}
