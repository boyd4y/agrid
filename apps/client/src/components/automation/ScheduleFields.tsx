import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@tabdo/ui/components/select";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@tabdo/ui/components/field";
import type { AutomationSource } from "@tabdo/shared";

type Schedule = Extract<AutomationSource, { kind: "schedule" }>;
function presetFor(cron: string) { return /^\d+ \d+ \* \* \*$/.test(cron) ? "daily" : /^\d+ \d+ \* \* [0-6]$/.test(cron) ? "weekly" : "cron"; }
export function ScheduleFields({ value, onChange, onPreview, disabled }: { value: Schedule; onChange: (value: Schedule) => void; onPreview: (value: Schedule) => Promise<string[]>; disabled?: boolean }) {
  const { t } = useTranslation("automation");
  const [preset, setPreset] = useState(presetFor(value.cron)), [preview, setPreview] = useState<string[]>([]), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const generation = useRef(0), alive = useRef(true);
  useEffect(() => { generation.current++; setPreview([]); setError(null); }, [value.cron, value.timeZone]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [minute = "0", hour = "9", , , weekday = "1"] = value.cron.split(/\s+/);
  const update = (cron: string, timeZone = value.timeZone) => { setPreview([]); setError(null); onChange({ kind: "schedule", cron, timeZone }); };
  return <FieldGroup>
    <Field><FieldLabel>{t("generic.schedule.frequency")}</FieldLabel><Select disabled={disabled} value={preset} onValueChange={next => { setPreset(next); if (next !== "cron") update(`${/^\d+$/.test(minute) ? minute : "0"} ${/^\d+$/.test(hour) ? hour : "9"} * * ${next === "weekly" ? /^[0-6]$/.test(weekday) ? weekday : "1" : "*"}`); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{["daily", "weekly", "cron"].map(item => <SelectItem key={item} value={item}>{t(`generic.schedule.${item}`)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
    {preset === "cron" ? <Field><FieldLabel htmlFor="schedule-cron">{t("generic.schedule.expression")}</FieldLabel><Input disabled={disabled} id="schedule-cron" value={value.cron} onChange={event => update(event.target.value)} placeholder="0 9 * * *" /></Field> : <Field><FieldLabel htmlFor="schedule-time">{t("generic.schedule.time")}</FieldLabel><Input disabled={disabled} id="schedule-time" type="time" value={`${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`} onChange={event => { const [hour, minute] = event.target.value.split(":"); if (hour && minute) update(`${Number(minute)} ${Number(hour)} * * ${preset === "weekly" ? weekday : "*"}`); }} /></Field>}
    {preset === "weekly" && <Field><FieldLabel>{t("generic.schedule.weekday")}</FieldLabel><Select disabled={disabled} value={weekday} onValueChange={day => update(`${minute} ${hour} * * ${day}`)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{[0, 1, 2, 3, 4, 5, 6].map(day => <SelectItem key={day} value={String(day)}>{t(`generic.schedule.days.${day}`)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>}
    <Field><FieldLabel htmlFor="schedule-timezone">{t("generic.schedule.timeZone")}</FieldLabel><Input disabled={disabled} id="schedule-timezone" value={value.timeZone} onChange={event => update(value.cron, event.target.value)} list="automation-timezones" /><datalist id="automation-timezones">{Intl.supportedValuesOf("timeZone").map(zone => <option key={zone} value={zone} />)}</datalist></Field>
    <Field><Button type="button" variant="outline" disabled={busy || disabled} onClick={async () => { const current = generation.current; setBusy(true); setError(null); try { const preview = await onPreview(value); if (alive.current && current === generation.current) setPreview(preview); } catch (error) { if (alive.current && current === generation.current) setError(error instanceof Error ? error.message : t("loadFailed")); } finally { if (alive.current) setBusy(false); } }}>{t("generic.schedule.preview")}</Button>{error && <FieldDescription role="alert">{error}</FieldDescription>}{preview.length > 0 && <ul className="flex flex-col gap-1 text-sm text-muted-foreground">{preview.map(date => <li key={date}><time dateTime={date}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: value.timeZone }).format(new Date(date))}</time></li>)}</ul>}</Field>
  </FieldGroup>;
}
