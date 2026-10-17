import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CalendarResults } from "@tabdo/shared";
import { calendarCommand } from "@/lib/calendar-api";
import { Button } from "@tabdo/ui/components/button";
import { FieldError } from "@tabdo/ui/components/field";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@tabdo/ui/components/collapsible";
import { CalendarDays } from "lucide-react";

export function BookingAvailability({ calendarId, personId, duration, zone, disabled, onChoose }: { calendarId: string; personId: string; duration: number; zone: string; disabled: boolean; onChoose(start: string): void }) {
  const { t, i18n } = useTranslation("calendar");
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [availability, setAvailability] = useState<CalendarResults["queryAvailability"]>(), [count, setCount] = useState(50);
  const request = useRef<AbortController | null>(null);
  useEffect(() => { request.current?.abort(); setAvailability(undefined); setError(""); setLoading(false); return () => request.current?.abort(); }, [calendarId, personId, duration]);
  async function query() {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(""); setAvailability(undefined);
    try {
      const rangeStart = new Date(Math.ceil(Date.now() / 60000) * 60000).toISOString();
      const result = await calendarCommand("queryAvailability", { calendarId, personId, rangeStart, rangeEnd: new Date(Date.parse(rangeStart) + 7 * 86400000).toISOString(), durationMinutes: duration }, controller.signal);
      if (!controller.signal.aborted) { setAvailability(result); setCount(50); }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("errors.REQUEST_FAILED")); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  return <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-3">
    <CollapsibleTrigger asChild><Button type="button" variant="outline" disabled={disabled}><CalendarDays data-icon="inline-start" />{t("availability")}</Button></CollapsibleTrigger>
    <CollapsibleContent className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t("availabilityHint")}</p>
      <Button type="button" variant="outline" disabled={disabled || loading || !personId || !Number.isInteger(duration) || duration < 1 || duration > 1440} onClick={() => void query()}>{t(loading ? "loading" : "findAvailability")}</Button>
      {error && <FieldError role="alert">{error}</FieldError>}
      {availability && <><p role="status" className="text-sm">{t("slotCount", { count: availability.slots.length })}</p><div className="flex flex-wrap gap-2">{availability.slots.slice(0, count).map(slot => <Button type="button" key={slot.start} variant="outline" size="sm" disabled={disabled} onClick={() => onChoose(slot.start)}>{new Intl.DateTimeFormat(i18n.language, { timeZone: zone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" }).format(new Date(slot.start))}</Button>)}</div>{count < availability.slots.length && <Button type="button" variant="ghost" onClick={() => setCount(value => value + 50)}>{t("moreSlots")}</Button>}</>}
    </CollapsibleContent>
  </Collapsible>;
}
