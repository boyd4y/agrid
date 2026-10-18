import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import type { Booking, BookingReceipt, BookingReminder, CalendarResults } from "@tabdo/shared";
import { calendarCommand } from "@/lib/calendar-api";
import { useMemberOptions } from "@/hooks/useMemberOptions";
import { Button } from "@tabdo/ui/components/button";
import { DataRefreshButton } from "@/components/controls/data-refresh-button";
import { Input } from "@tabdo/ui/components/input";
import { Textarea } from "@tabdo/ui/components/textarea";
import { Badge } from "@tabdo/ui/components/badge";
import { Separator } from "@tabdo/ui/components/separator";
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldError, FieldSet, FieldLegend } from "@tabdo/ui/components/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@tabdo/ui/components/select";

type Props = { booking: Booking; disabled: boolean; onPending(pending: boolean): void; onSaved(receipt: BookingReceipt): Promise<void> };
export function BookingReminders({ booking, disabled, onPending, onSaved }: Props) {
  const { t, i18n } = useTranslation("calendar");
  const members = useMemberOptions(), agents = members.filter(member => member.kind === "agent");
  const [configuration, setConfiguration] = useState<BookingReminder[]>([]), [history, setHistory] = useState<CalendarResults["listBookingReminders"]>();
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [error, setError] = useState(""), [revision, setRevision] = useState(0);
  const dirty = useRef(false);
  const retry = useRef({ hash: "", key: "" }), busy = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    void calendarCommand("listBookingReminders", { calendarId: booking.calendarId, bookingId: booking.id }, controller.signal).then(result => {
      if (!controller.signal.aborted) { setHistory(result); if (!dirty.current) setConfiguration(result.reminders); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [booking.id, revision]);
  function update(index: number, change: Partial<BookingReminder>) { dirty.current = true; setConfiguration(current => current.map((item, position) => position === index ? { ...item, ...change } : item)); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy.current) return;
    const input = { calendarId: booking.calendarId, bookingId: booking.id, expectedVersion: booking.version, reminders: configuration };
    const hash = JSON.stringify(input);
    if (retry.current.hash !== hash) retry.current = { hash, key: crypto.randomUUID() };
    busy.current = true; setPending(true); onPending(true); setError("");
    try {
      const receipt = await calendarCommand("setBookingReminders", { ...input, idempotencyKey: retry.current.key });
      await onSaved(receipt); dirty.current = false; setRevision(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("errors.REQUEST_FAILED")); }
    finally { busy.current = false; setPending(false); onPending(false); }
  }
  const valid = configuration.every(item => item.agentUserId && item.prompt.trim() && item.maxLatenessMinutes >= 1 && item.maxLatenessMinutes <= 1440 && (item.kind === "at_end" || item.offsetMinutes > 0 && item.offsetMinutes <= 43200));
  return <section className="flex flex-col gap-4 p-4" data-testid="booking-reminders">
    <Separator />
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">{t("reminders.title")}</h3><DataRefreshButton label={t("reminders.refresh")} disabled={pending || loading || disabled} onRefresh={() => setRevision(value => value + 1)} /></div>
    <p className="text-xs text-muted-foreground">{t("reminders.boundary")}</p>
    {loading ? <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p> : <form noValidate onSubmit={save} className="flex flex-col gap-4" aria-busy={pending}>
      <fieldset disabled={pending || disabled || booking.status !== "confirmed"} className="flex min-w-0 flex-col gap-4">
        {configuration.map((item, index) => <FieldSet key={index} className="gap-3 border-b pb-4"><div className="flex items-center justify-between gap-2"><FieldLegend variant="label">{t("reminders.item", { index: index + 1 })}</FieldLegend><Button type="button" variant="ghost" size="icon" aria-label={t("reminders.remove", { index: index + 1 })} onClick={() => { dirty.current = true; setConfiguration(current => current.filter((_, position) => position !== index)); }}><Trash2 /></Button></div>
          <FieldGroup>
            <Field><FieldLabel>{t("reminders.kind")}</FieldLabel><Select value={item.kind} onValueChange={kind => update(index, { kind: kind as BookingReminder["kind"], offsetMinutes: kind === "at_end" ? 0 : 30 })}><SelectTrigger aria-label={t("reminders.kind")}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="before_start">{t("reminders.before_start")}</SelectItem><SelectItem value="at_end">{t("reminders.at_end")}</SelectItem></SelectGroup></SelectContent></Select></Field>
            {item.kind === "before_start" && <Field><FieldLabel htmlFor={`reminder-offset-${index}`}>{t("reminders.offset")}</FieldLabel><Input id={`reminder-offset-${index}`} type="number" min={1} max={43200} value={item.offsetMinutes} onChange={event => update(index, { offsetMinutes: Number(event.target.value) })} /></Field>}
            <Field><FieldLabel>{t("reminders.agent")}</FieldLabel><Select value={item.agentUserId} onValueChange={agentUserId => update(index, { agentUserId })}><SelectTrigger aria-label={t("reminders.agent")}><SelectValue placeholder={t("reminders.pickAgent")} /></SelectTrigger><SelectContent><SelectGroup>{agents.map(agent => <SelectItem key={agent.userId} value={agent.userId}>{agent.name}</SelectItem>)}</SelectGroup></SelectContent></Select>{!agents.length && <FieldDescription>{t("reminders.noAgents")}</FieldDescription>}</Field>
            <Field><FieldLabel htmlFor={`reminder-prompt-${index}`}>{t("reminders.prompt")}</FieldLabel><Textarea id={`reminder-prompt-${index}`} maxLength={30000} value={item.prompt} onChange={event => update(index, { prompt: event.target.value })} /><FieldDescription>{t("reminders.promptHint")}</FieldDescription></Field>
            <Field><FieldLabel htmlFor={`reminder-lateness-${index}`}>{t("reminders.lateness")}</FieldLabel><Input id={`reminder-lateness-${index}`} type="number" min={1} max={1440} value={item.maxLatenessMinutes} onChange={event => update(index, { maxLatenessMinutes: Number(event.target.value) })} /></Field>
          </FieldGroup>
        </FieldSet>)}
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={configuration.length >= 10} onClick={() => { dirty.current = true; setConfiguration(current => [...current, { kind: "before_start", offsetMinutes: 30, agentUserId: agents[0]?.userId ?? "", prompt: "", maxLatenessMinutes: 60 }]); }}><Plus data-icon="inline-start" />{t("reminders.add")}</Button><Button type="submit" size="sm" disabled={!valid}>{t(pending ? "saving" : "reminders.save")}</Button></div>
        {!configuration.length && <p className="text-xs text-muted-foreground">{t("reminders.none")}</p>}
      </fieldset>
    </form>}
    {error && <FieldError role="alert">{error}</FieldError>}
    {!!history?.intents.length && <div className="flex flex-col gap-2"><h4 className="text-sm font-medium">{t("reminders.history")}</h4><ul className="divide-y border-y">{history.intents.map(intent => <li key={intent.id} className="flex flex-col gap-2 py-3 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><span>{t(`reminders.${intent.kind}`)} · {t("reminders.revision", { revision: intent.revision })}</span><Badge variant="secondary">{t(`reminders.status.${intent.status}`, { defaultValue: intent.status })}</Badge></div><time dateTime={intent.scheduledFor}>{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short", timeZone: booking.timeZone }).format(new Date(intent.scheduledFor))} · {booking.timeZone}</time>{intent.reason && <p className="text-muted-foreground">{t(`reminders.reasons.${intent.reason}`, { defaultValue: intent.reason })}</p>}{intent.acceptedAt && <p className="text-muted-foreground">{t("reminders.acceptedAt", { at: new Date(intent.acceptedAt).toLocaleString(i18n.language) })}</p>}{intent.threadId && <Button asChild variant="outline" size="sm" className="self-start"><Link to={`/app?thread=${encodeURIComponent(intent.threadId)}`}>{t("reminders.openRun")}</Link></Button>}</li>)}</ul></div>}
  </section>;
}
