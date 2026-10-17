import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import type { AvailabilityException, Calendar, CalendarPerson, WorkingWindow } from "@tabdo/shared";
import { calendarCommand } from "@/lib/calendar-api";
import { useMemberOptions } from "@/hooks/useMemberOptions";
import { DatePicker } from "@/components/controls/date-picker";
import { DeleteConfirmation } from "@/components/controls/delete-confirmation";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Field, FieldError, FieldGroup, FieldLabel, FieldDescription } from "@tabdo/ui/components/field";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@tabdo/ui/components/sheet";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@tabdo/ui/components/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@tabdo/ui/components/tabs";
import { Separator } from "@tabdo/ui/components/separator";

const key = () => crypto.randomUUID();
export function CalendarEditor({ calendar, onClose, onSaved }: { calendar?: Calendar; onClose(): void; onSaved(calendar: Calendar): Promise<void> }) {
  const { t } = useTranslation("calendar");
  const [name, setName] = useState(calendar?.name ?? ""), [zone, setZone] = useState(calendar?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const retry = useRef({ hash: "", key: key() });
  return <Sheet open onOpenChange={open => { if (!open && !pending) onClose(); }}><SheetContent><SheetHeader><SheetTitle>{t(calendar ? "editCalendar" : "newCalendar")}</SheetTitle><SheetDescription>{t("calendarHint")}</SheetDescription><Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onClose}>{t("close")}</Button></SheetHeader>
    <form noValidate className="flex flex-col gap-5 p-4" onSubmit={async e => {
      e.preventDefault(); if (pending) return;
      const hash = JSON.stringify([name, zone]); if (retry.current.hash !== hash) retry.current = { hash, key: key() };
      setPending(true); setError("");
      try { const input = { name, timeZone: zone, idempotencyKey: retry.current.key }; const saved = calendar ? await calendarCommand("updateCalendar", { ...input, calendarId: calendar.id, expectedVersion: calendar.version }) : await calendarCommand("createCalendar", input); await onSaved(saved); onClose(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : t("errors.REQUEST_FAILED")); } finally { setPending(false); }
    }}><FieldGroup><Field><FieldLabel htmlFor="calendar-name">{t("name")}</FieldLabel><Input id="calendar-name" value={name} required maxLength={200} disabled={pending} onChange={e => setName(e.target.value)} /></Field><Field><FieldLabel htmlFor="calendar-zone">{t("timeZone")}</FieldLabel><Input id="calendar-zone" value={zone} required disabled={pending} onChange={e => setZone(e.target.value)} placeholder="Asia/Shanghai" /></Field></FieldGroup>{error && <FieldError role="alert">{error}</FieldError>}<Button disabled={pending || !name.trim()}>{t(pending ? "saving" : "save")}</Button></form>
  </SheetContent></Sheet>;
}

type Props = { calendar: Calendar; people: CalendarPerson[]; onClose(): void; onSaved(): Promise<void> };
export function CalendarManagement(props: Props) {
  const { t } = useTranslation("calendar");
  const [pending, setPending] = useState(false);
  const [personId, setPersonId] = useState(props.people[0]?.id ?? "new");
  const person = props.people.find(item => item.id === personId);
  useEffect(() => { if (personId !== "new" && !props.people.some(item => item.id === personId)) setPersonId(props.people[0]?.id ?? "new"); }, [props.people, personId]);
  return <Sheet open onOpenChange={open => { if (!open && !pending) props.onClose(); }}><SheetContent className="overflow-y-auto sm:max-w-lg"><SheetHeader><SheetTitle>{t("manage")}</SheetTitle><SheetDescription>{t("manageHint")}</SheetDescription><Button type="button" variant="ghost" size="sm" disabled={pending} onClick={props.onClose}>{t("close")}</Button></SheetHeader>
    <div className="flex flex-col gap-5 p-4"><Field><FieldLabel>{t("person")}</FieldLabel><Select value={personId} onValueChange={setPersonId} disabled={pending}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{props.people.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}<SelectItem value="new">{t("newPerson")}</SelectItem></SelectGroup></SelectContent></Select></Field>
      <PersonSettings key={personId} calendar={props.calendar} person={person} onPending={setPending} onSaved={async saved => { await props.onSaved(); if (saved) setPersonId(saved.id); }} />
    </div>
  </SheetContent></Sheet>;
}
function PersonSettings({ calendar, person, onSaved, onPending }: { calendar: Calendar; person?: CalendarPerson; onPending(pending: boolean): void; onSaved(person?: CalendarPerson): Promise<void> }) {
  const { t } = useTranslation("calendar"), members = useMemberOptions();
  const [name, setName] = useState(person?.name ?? ""), [zone, setZone] = useState(person?.timeZone ?? calendar.timeZone), [userId, setUserId] = useState("none");
  const [windows, setWindows] = useState<WorkingWindow[]>(person?.windows ?? []);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([]), [exception, setException] = useState<AvailabilityException>();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10)), [restStart, setRestStart] = useState("00:00"), [restEnd, setRestEnd] = useState("24:00");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const retry = useRef({ hash: "", key: key() });
  const [restRevision, setRestRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (person) {
      const end = new Date(`${date}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 31);
      void calendarCommand("listAvailabilityExceptions", { calendarId: calendar.id, personId: person.id, startDate: date, endDate: end.toISOString().slice(0, 10) }, controller.signal)
        .then(result => { if (!controller.signal.aborted) setExceptions(result.items); })
        .catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    }
    return () => controller.abort();
  }, [calendar.id, person?.id, date, restRevision]);
  const run = async (work: () => Promise<void>) => { if (pending) return; setPending(true); onPending(true); setError(""); try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("errors.REQUEST_FAILED")); } finally { setPending(false); onPending(false); } };
  const idem = (values: unknown) => { const hash = JSON.stringify(values); if (retry.current.hash !== hash) retry.current = { hash, key: key() }; return retry.current.key; };
  return <>
    <Tabs defaultValue="person"><TabsList><TabsTrigger disabled={pending} value="person">{t("person")}</TabsTrigger>{person && <><TabsTrigger disabled={pending} value="hours">{t("hours")}</TabsTrigger><TabsTrigger disabled={pending} value="rest">{t("timeOff")}</TabsTrigger></>}</TabsList>
      <TabsContent value="person"><form noValidate className="flex flex-col gap-5 pt-4" onSubmit={e => { e.preventDefault(); void run(async () => {
        const input = { calendarId: calendar.id, name, timeZone: zone, idempotencyKey: idem(["person", name, zone, userId, person?.version]) };
        const saved = person ? await calendarCommand("updateCalendarPerson", { ...input, personId: person.id, expectedVersion: person.version }) : await calendarCommand("createCalendarPerson", { ...input, userId: userId === "none" ? null : userId });
        await onSaved(saved);
      }); }}><FieldGroup><Field><FieldLabel htmlFor="person-name">{t("name")}</FieldLabel><Input id="person-name" required value={name} maxLength={200} disabled={pending} onChange={e => setName(e.target.value)} /></Field><Field><FieldLabel htmlFor="person-zone">{t("timeZone")}</FieldLabel><Input id="person-zone" required value={zone} disabled={pending} onChange={e => setZone(e.target.value)} /><FieldDescription>{t("personZoneHint")}</FieldDescription></Field>
        {!person && <Field><FieldLabel>{t("bindMember")}</FieldLabel><Select value={userId} onValueChange={setUserId} disabled={pending}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="none">{t("independentPerson")}</SelectItem>{members.filter(item => item.kind === "human").map(item => <SelectItem key={item.userId} value={item.userId}>{item.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>}
      </FieldGroup><div className="flex flex-wrap gap-2"><Button disabled={pending || !name.trim()}>{t(pending ? "saving" : "save")}</Button>{person && <Button type="button" variant="destructive-ghost" disabled={pending} onClick={() => setConfirmArchive(true)}>{t("archivePerson")}</Button>}</div></form></TabsContent>
      {person && <><TabsContent value="hours"><form noValidate className="flex flex-col gap-4 pt-4" onSubmit={e => { e.preventDefault(); void run(async () => { const saved = await calendarCommand("setWorkingHours", { calendarId: calendar.id, personId: person.id, expectedVersion: person.version, windows, idempotencyKey: idem(["hours", person.version, windows]) }); await onSaved(saved); }); }}>
        <p className="text-sm text-muted-foreground">{t("hoursHint", { zone: person.timeZone })}</p>
        <FieldGroup>{windows.map((window, index) => <Field key={index}><FieldLabel>{t("workingWindow", { count: index + 1 })}</FieldLabel><div className="flex flex-wrap items-center gap-2"><Select value={String(window.day)} onValueChange={value => setWindows(items => items.map((item, i) => i === index ? { ...item, day: Number(value) } : item))} disabled={pending}><SelectTrigger className="w-28" aria-label={t("weekday")}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{[1, 2, 3, 4, 5, 6, 7].map(day => <SelectItem key={day} value={String(day)}>{t(`days.${day}`)}</SelectItem>)}</SelectGroup></SelectContent></Select><Input className="w-20" aria-label={t("startTime")} value={window.start} disabled={pending} onChange={e => setWindows(items => items.map((item, i) => i === index ? { ...item, start: e.target.value } : item))} /><Input className="w-20" aria-label={t("endTime")} value={window.end} disabled={pending} onChange={e => setWindows(items => items.map((item, i) => i === index ? { ...item, end: e.target.value } : item))} /><Button type="button" variant="ghost" size="icon" aria-label={t("removeWindow")} disabled={pending} onClick={() => setWindows(items => items.filter((_, i) => i !== index))}><Trash2 /></Button></div></Field>)}</FieldGroup>
        <Button type="button" variant="outline" disabled={pending || windows.length >= 70} onClick={() => setWindows(items => [...items, { day: 1, start: "09:00", end: "17:00" }])}><Plus data-icon="inline-start" />{t("addWindow")}</Button><Button disabled={pending}>{t(pending ? "saving" : "saveHours")}</Button>
      </form></TabsContent>
      <TabsContent value="rest"><form noValidate className="flex flex-col gap-4 pt-4" onSubmit={e => { e.preventDefault(); void run(async () => {
        await calendarCommand("setAvailabilityException", { calendarId: calendar.id, personId: person.id, ...(exception ? { exceptionId: exception.id, expectedVersion: exception.version } : {}), date, intervals: [{ start: restStart, end: restEnd }, ...(exception?.intervals.slice(1) ?? [])], idempotencyKey: idem(["rest", date, restStart, restEnd, exception?.version, exception?.id]) });
        setException(undefined); setRestRevision(value => value + 1); await onSaved();
      }); }}><FieldGroup><Field><FieldLabel>{t("date")}</FieldLabel><DatePicker value={date} onChange={value => { if (value && !pending) setDate(value); }} /></Field><Field><FieldLabel htmlFor="rest-start">{t("startTime")}</FieldLabel><Input id="rest-start" value={restStart} disabled={pending} onChange={e => setRestStart(e.target.value)} /></Field><Field><FieldLabel htmlFor="rest-end">{t("endTime")}</FieldLabel><Input id="rest-end" value={restEnd} disabled={pending} onChange={e => setRestEnd(e.target.value)} /><FieldDescription>{t("fullDayHint")}</FieldDescription></Field></FieldGroup><div className="flex flex-wrap gap-2"><Button disabled={pending}>{t(exception ? "saveTimeOff" : "addTimeOff")}</Button>{exception && <Button type="button" variant="outline" onClick={() => setException(undefined)}>{t("newTimeOff")}</Button>}</div></form>
        <Separator className="my-4" /><p className="mb-2 text-xs text-muted-foreground">{t("exceptionsRange")}</p><ul className="flex flex-col gap-2">{exceptions.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm"><span>{item.date} · {item.intervals.map(value => `${value.start}–${value.end}`).join(", ")}</span><div className="flex gap-1"><Button variant="ghost" size="sm" disabled={pending} onClick={() => { setException(item); setDate(item.date); setRestStart(item.intervals[0].start); setRestEnd(item.intervals[0].end); }}>{t("edit")}</Button><Button variant="destructive-ghost" size="sm" disabled={pending} onClick={() => void run(async () => { await calendarCommand("removeAvailabilityException", { calendarId: calendar.id, personId: person.id, exceptionId: item.id, expectedVersion: item.version, idempotencyKey: `remove:${item.id}:${item.version}` }); setRestRevision(value => value + 1); await onSaved(); })}>{t("removeTimeOff")}</Button></div></li>)}</ul>
      </TabsContent></>}
    </Tabs>
    {error && <FieldError role="alert">{error}</FieldError>}
    <DeleteConfirmation open={confirmArchive} onOpenChange={setConfirmArchive} labels={{ confirmDelete: t("confirmArchive"), deleting: t("archiving") }} title={t("archivePerson")} description={t("archiveHint")} onConfirm={async () => { if (!person) return; await calendarCommand("archiveCalendarPerson", { calendarId: calendar.id, personId: person.id, expectedVersion: person.version, idempotencyKey: `archive:${person.id}:${person.version}` }); await onSaved(); }} />
  </>;
}
