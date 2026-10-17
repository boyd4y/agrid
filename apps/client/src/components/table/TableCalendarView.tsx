import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar, { type CalendarRef, type DatesSetInfo, type EventDropInfo } from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import listPlugin from "@fullcalendar/react/list";
import interactionPlugin from "@fullcalendar/react/interaction";
import themePlugin from "@fullcalendar/react/themes/monarch";
import zhLocale from "@fullcalendar/react/locales/zh-cn";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/monarch/theme.css";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { shiftCalendarDate, type CalendarViewConfig, type CalendarViewResult, type TableView } from "@tabdo/shared";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@tabdo/ui/components/collapsible";
import { Button } from "@tabdo/ui/components/button";
import { ToggleGroup, ToggleGroupItem } from "@tabdo/ui/components/toggle-group";
import { CalendarViewSettings } from "@/components/table/CalendarViewSettings";
import { openRelatedRecord } from "@/components/table/RelationPicker";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useMemberOptions } from "@/hooks/useMemberOptions";
import { api } from "@/lib/api";
import type { FullTable } from "@/types/table";

const plugins = [themePlugin, dayGridPlugin, listPlugin, interactionPlugin];
export function TableCalendarView({ table, view, refreshToken, onUpdated }: { table: FullTable; view: TableView; refreshToken?: number; onUpdated: (view: TableView) => void }) {
  const { t, i18n } = useTranslation("table");
  const narrow = useMediaQuery("(max-width: 767px)"), members = useMemberOptions();
  const calendar = useRef<CalendarRef>(null), busy = useRef(false), generation = useRef(0);
  const [display, setDisplay] = useState(narrow ? "listMonth" : "dayGridMonth"), [title, setTitle] = useState("");
  const [range, setRange] = useState<{ rangeStart: string; rangeEnd: string }>();
  const [page, setPage] = useState<CalendarViewResult>(), [error, setError] = useState("");
  const [loading, setLoading] = useState(false), [pending, setPending] = useState(false), [revision, setRevision] = useState(0);
  const config = view.config as CalendarViewConfig;
  const configKey = JSON.stringify(config);
  const load = useCallback(async (signal?: AbortSignal, cursor?: string | null) => {
    if (!range) return;
    const current = generation.current; setLoading(true); setError("");
    try {
      const result = await api.queryCalendarView({ viewId: view.id, ...range, cursor }, signal);
      if (signal?.aborted || current !== generation.current) return;
      setPage(previous => cursor && previous ? { ...result, items: [...previous.items, ...result.items.filter(item => !previous.items.some(old => old.rowId === item.rowId))] } : result);
    } catch (cause) { if (!signal?.aborted && current === generation.current) setError(cause instanceof Error ? cause.message : t("loadFailed")); }
    finally { if (!signal?.aborted && current === generation.current) setLoading(false); }
  }, [range, view.id, configKey, t]);
  useEffect(() => {
    generation.current++; const controller = new AbortController(); setPage(undefined);
    void load(controller.signal); return () => { controller.abort(); generation.current++; };
  }, [load, refreshToken, revision]);
  useEffect(() => { if (narrow) { setDisplay("listMonth"); calendar.current?.getApi().changeView("listMonth"); } }, [narrow]);
  const datesSet = useCallback((info: DatesSetInfo) => {
    // UTC calendar receives only date strings, independent of the browser's zone/DST.
    const rangeStart = info.startStr.slice(0, 10), rangeEnd = info.endStr.slice(0, 10);
    setRange(previous => previous?.rangeStart === rangeStart && previous.rangeEnd === rangeEnd ? previous : { rangeStart, rangeEnd }); setTitle(info.view.title);
  }, []);
  const events = useMemo(() => (page?.items ?? []).map(item => {
    const people = (Array.isArray(item.person) ? item.person : item.person ? [item.person] : []).map(id => members.find(member => member.id === id)?.name).filter(Boolean).join(", ");
    return { id: item.rowId, title: `${item.title || t("untitled")}${people ? ` · ${people}` : ""}`, start: item.start, end: item.end, allDay: true };
  }), [page?.items, members, t]);
  const openRecord = (rowId: string) => { const item = page?.items.find(item => item.rowId === rowId); if (item) openRelatedRecord({ id: rowId, tableId: table.id, title: item.title || t("untitled") }); };
  async function move(info: EventDropInfo) {
    const item = page?.items.find(item => item.rowId === info.event.id);
    const start = info.event.startStr.slice(0, 10), end = info.event.endStr.slice(0, 10);
    if (busy.current || loading || !item || !start || !end || !config.startColumnId) { info.revert(); return; }
    busy.current = true; setPending(true); setError("");
    try {
      await api.patchRow(item.rowId, { expectedVersion: item.version, cells: { [config.startColumnId]: start, ...(config.endColumnId ? { [config.endColumnId]: config.endMode === "exclusive" ? end : shiftCalendarDate(end, -1) } : {}) } });
      setRevision(value => value + 1);
    } catch (cause) { info.revert(); setError(cause instanceof Error ? cause.message : t("saveFailed")); }
    finally { busy.current = false; setPending(false); }
  }
  const diagnostics = page?.diagnostics;
  const excluded = diagnostics ? diagnostics.emptyStart + diagnostics.invalidStart + diagnostics.invalidEnd + diagnostics.reversed : 0;
  const mappingValid = !diagnostics?.mapping.length;
  return <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-auto" data-testid="table-calendar-view" aria-busy={loading || pending}>
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1"><Button variant="outline" size="icon" aria-label={t("calendarView.previous")} disabled={pending} onClick={() => calendar.current?.getApi().prev()}><ChevronLeft /></Button><Button variant="outline" size="icon" aria-label={t("calendarView.next")} disabled={pending} onClick={() => calendar.current?.getApi().next()}><ChevronRight /></Button><Button variant="outline" size="sm" disabled={pending} onClick={() => calendar.current?.getApi().today()}>{t("calendarView.today")}</Button></div>
      <h2 className="text-sm font-medium">{title}</h2>
      <ToggleGroup type="single" value={display} disabled={pending} onValueChange={value => { if (value) { setDisplay(value); calendar.current?.getApi().changeView(value); } }} className="ml-auto" aria-label={t("calendarView.display")}><ToggleGroupItem value="dayGridMonth" aria-label={t("calendarView.month")}>{t("calendarView.month")}</ToggleGroupItem><ToggleGroupItem value="listMonth" aria-label={t("calendarView.agenda")}>{t("calendarView.agenda")}</ToggleGroupItem></ToggleGroup>
      <CalendarViewSettings table={table} view={view} onSaved={onUpdated} />
    </div>
    <p className="text-xs text-muted-foreground">{t("calendarView.description")}</p>
    {error && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">{error}<Button variant="outline" size="sm" disabled={pending || loading} onClick={() => setRevision(value => value + 1)}><RefreshCw />{t("calendarView.retry")}</Button></div>}
    {diagnostics && !mappingValid && <div role="alert" className="space-y-1 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm"><p>{t("calendarView.repair")}</p>{diagnostics.mapping.map(issue => <p key={issue.field}>{t(`calendarView.${issue.field}`)}: {t(`calendarView.issues.${issue.code}`)}</p>)}</div>}
    {excluded > 0 && <Collapsible className="text-sm text-muted-foreground" data-testid="calendar-diagnostics"><CollapsibleTrigger asChild><Button variant="ghost" size="sm">{t("calendarView.excluded", { count: excluded })}</Button></CollapsibleTrigger><CollapsibleContent><p>{t("calendarView.diagnosticCounts", diagnostics)}</p></CollapsibleContent></Collapsible>}
    {loading && <p role="status" className="text-xs text-muted-foreground">{t("loadingView")}</p>}
    <div className="tabdo-booking-calendar min-h-[30rem] min-w-0 flex-1" data-testid="table-calendar-canvas">
      <FullCalendar ref={calendar} plugins={plugins} initialView={display} timeZone="UTC" locale={i18n.language.startsWith("zh") ? zhLocale : "en"} headerToolbar={false} height="100%" datesSet={datesSet} events={events} editable={Boolean(page) && mappingValid && !loading && !pending && !error} eventDurationEditable={false} eventDrop={info => void move(info)} eventClick={info => { info.jsEvent.preventDefault(); openRecord(info.event.id); }} noEventsText={t("calendarView.empty")}
        eventDidMount={info => { info.el.dataset.calendarRowId = info.event.id; info.el.tabIndex = 0; info.el.setAttribute("role", "button"); info.el.setAttribute("aria-label", info.event.title); info.el.onkeydown = event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openRecord(info.event.id); } }; }} />
    </div>
    {page?.hasMore && <div className="flex shrink-0 flex-col items-start gap-2 pb-20 md:flex-row md:items-center md:justify-center md:pb-0"><span className="text-xs text-muted-foreground">{t("calendarView.partial", { count: page.items.length })}</span><Button variant="outline" disabled={loading || pending} onClick={() => void load(undefined, page.nextCursor)}>{t("calendarView.loadMore")}</Button></div>}
  </div>;
}
