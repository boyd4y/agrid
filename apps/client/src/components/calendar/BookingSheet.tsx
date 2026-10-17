import { BookingAvailability } from "@/components/calendar/BookingAvailability";
import { BookingReminders } from "@/components/calendar/BookingReminders";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Booking, CalendarPerson } from "@tabdo/shared";
import { calendarCommand } from "@/lib/calendar-api";
import { bookingDraft, wallTimeOptions } from "@/components/calendar/calendar-time";
import { DatePicker } from "@/components/controls/date-picker";
import { DeleteConfirmation } from "@/components/controls/delete-confirmation";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Field, FieldError, FieldGroup, FieldLabel, FieldDescription } from "@tabdo/ui/components/field";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@tabdo/ui/components/sheet";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@tabdo/ui/components/select";
import { Badge } from "@tabdo/ui/components/badge";

type Props = { calendarId: string; people: CalendarPerson[]; personId?: string; start: string; duration: number; booking?: Booking; initialError?: string; onClose(): void; onSaved(): Promise<void> };
export function BookingSheet(props: Props) {
  const { t } = useTranslation("calendar");
  const [booking, setBooking] = useState(props.booking);
  const [reminderPending, setReminderPending] = useState(false);
  const [personId, setPersonId] = useState(booking?.personId ?? props.personId ?? props.people[0]?.id ?? "");
  const person = props.people.find(item => item.id === personId);
  const zone = person?.timeZone ?? booking?.timeZone ?? "UTC";
  const initial = useMemo(() => bookingDraft(props.start, zone), []);
  const [date, setDate] = useState(initial.date), [time, setTime] = useState(initial.time), [offset, setOffset] = useState(initial.offset);
  const [duration, setDuration] = useState(props.duration);
  const [title, setTitle] = useState(booking?.title ?? ""), [pending, setPending] = useState(false), [error, setError] = useState(props.initialError ?? "");
  const [cancel, setCancel] = useState(false);
  const busy = useRef(false);
  const retry = useRef<{ hash: string; key: string } | null>(null);
  const choices = wallTimeOptions(date, time, zone);
  const chosen = choices.find(item => item.offset === offset) ?? (choices.length === 1 ? choices[0] : undefined);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy.current || reminderPending || !chosen || !person) return;
    const value = { start: chosen.start, end: new Date(Date.parse(chosen.start) + duration * 60000).toISOString(), timeZone: zone };
    const input = booking ? { calendarId: props.calendarId, bookingId: booking.id, expectedVersion: booking.version, time: value } : { calendarId: props.calendarId, personId, title, time: value };
    const hash = JSON.stringify(input);
    if (retry.current?.hash !== hash) retry.current = { hash, key: crypto.randomUUID() };
    busy.current = true; setPending(true); setError("");
    try {
      if (booking) await calendarCommand("rescheduleBooking", { ...input, bookingId: booking.id, expectedVersion: booking.version, idempotencyKey: retry.current.key });
      else await calendarCommand("createBooking", { ...input, personId, title, idempotencyKey: retry.current.key });
      await props.onSaved(); props.onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("errors.REQUEST_FAILED")); }
    finally { busy.current = false; setPending(false); }
  }
  return <>
    <Sheet open onOpenChange={open => { if (!open && !busy.current && !reminderPending) props.onClose(); }}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader><SheetTitle>{t(booking ? "bookingDetails" : "newBooking")}</SheetTitle><SheetDescription>{t("bookingHint", { zone })}</SheetDescription><Button type="button" variant="ghost" size="sm" disabled={pending || reminderPending} onClick={props.onClose}>{t("close")}</Button></SheetHeader>
        <form noValidate onSubmit={save} className="flex flex-col gap-5 p-4" aria-busy={pending}>
          {booking && <Badge variant="secondary">{t(booking.status)}</Badge>}
          <FieldGroup>
            <Field><FieldLabel htmlFor="booking-person">{t("person")}</FieldLabel><Select value={personId} onValueChange={setPersonId} disabled={!!booking || pending || reminderPending}><SelectTrigger id="booking-person"><SelectValue placeholder={t("pickPerson")} /></SelectTrigger><SelectContent><SelectGroup>{props.people.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            <Field><FieldLabel htmlFor="booking-title">{t("bookingTitle")}</FieldLabel><Input id="booking-title" required maxLength={200} value={title} readOnly={!!booking} disabled={pending || reminderPending} onChange={e => setTitle(e.target.value)} /></Field>
            <Field><FieldLabel>{t("date")}</FieldLabel><DatePicker value={date} onChange={value => { if (value && !pending && !reminderPending) setDate(value); }} /></Field>
            <Field data-invalid={!choices.length}><FieldLabel htmlFor="booking-time">{t("startTime")}</FieldLabel><Input id="booking-time" value={time} placeholder="09:00" aria-invalid={!choices.length} disabled={pending || reminderPending} onChange={e => setTime(e.target.value)} /><FieldDescription>{zone}</FieldDescription>{!choices.length && <FieldError>{t("invalidWallTime")}</FieldError>}</Field>
            {choices.length > 1 && <Field><FieldLabel>{t("offsetChoice")}</FieldLabel><Select value={chosen?.offset ?? ""} onValueChange={setOffset} disabled={pending || reminderPending}><SelectTrigger><SelectValue placeholder={t("pickOffset")} /></SelectTrigger><SelectContent><SelectGroup>{choices.map(item => <SelectItem key={item.offset} value={item.offset}>{item.offset}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>}
            <Field><FieldLabel htmlFor="booking-duration">{t("duration")}</FieldLabel><Input id="booking-duration" type="number" min={1} max={1440} step={1} value={duration} disabled={pending || reminderPending} onChange={e => setDuration(Number(e.target.value))} /></Field>
          </FieldGroup>
          {!booking && <BookingAvailability calendarId={props.calendarId} personId={personId} duration={duration} zone={zone} disabled={pending || reminderPending} onChoose={start => { const slot = bookingDraft(start, zone); setDate(slot.date); setTime(slot.time); setOffset(slot.offset); }} />}
          {error && <FieldError role="alert">{error}</FieldError>}
          {booking?.status !== "cancelled" && <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending || reminderPending || !chosen || !person || !title.trim() || !Number.isInteger(duration) || duration < 1 || duration > 1440}>{t(pending ? "saving" : booking ? "reschedule" : "confirmBooking")}</Button>{booking && <Button type="button" variant="destructive-ghost" disabled={pending || reminderPending} onClick={() => setCancel(true)}>{t("cancelBooking")}</Button>}</div>}
        </form>
        {booking && <BookingReminders booking={booking} disabled={pending} onPending={setReminderPending} onSaved={async receipt => { setBooking(current => current ? { ...current, ...receipt } : current); await props.onSaved(); }} />}
      </SheetContent>
    </Sheet>
    <DeleteConfirmation open={cancel} onOpenChange={setCancel} labels={{ confirmDelete: t("confirmCancellation"), deleting: t("cancelling") }} title={t("cancelBooking")} description={t("cancelHint")} onConfirm={async () => {
      if (!booking) return;
      await calendarCommand("cancelBooking", { calendarId: props.calendarId, bookingId: booking.id, expectedVersion: booking.version, idempotencyKey: `cancel:${booking.id}:${booking.version}` });
      await props.onSaved(); props.onClose();
    }} />
  </>;
}
