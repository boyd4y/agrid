import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TimePicker } from "@tabdo/ui/components/time-picker";
import { Input } from "@tabdo/ui/components/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@tabdo/ui/components/select";
import { Field, FieldGroup, FieldLabel } from "@tabdo/ui/components/field";
import type { AutomationSource } from "@tabdo/shared";

type Schedule = Extract<AutomationSource, { kind: "schedule" }>;
function presetFor(cron: string) { return /^\d+ \d+ \* \* \*$/.test(cron) ? "daily" : /^\d+ \d+ \* \* [0-6]$/.test(cron) ? "weekly" : "cron"; }
export function ScheduleFields({ value, onChange, disabled }: { value: Schedule; onChange: (value: Schedule) => void; disabled?: boolean }) {
  const { t } = useTranslation("automation");
  const [preset, setPreset] = useState(presetFor(value.cron));
  const [minute = "0", hour = "9", , , weekday = "1"] = value.cron.split(/\s+/);
  const update = (cron: string, timeZone = value.timeZone) => { onChange({ kind: "schedule", cron, timeZone }); };
  return <FieldGroup className="grid min-w-0 gap-4 sm:grid-cols-2">
    <Field><FieldLabel>{t("generic.schedule.frequency")}</FieldLabel><Select disabled={disabled} value={preset} onValueChange={next => { setPreset(next); if (next !== "cron") update(`${/^\d+$/.test(minute) ? minute : "0"} ${/^\d+$/.test(hour) ? hour : "9"} * * ${next === "weekly" ? /^[0-6]$/.test(weekday) ? weekday : "1" : "*"}`); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{["daily", "weekly", "cron"].map(item => <SelectItem key={item} value={item}>{t(`generic.schedule.${item}`)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
    {preset === "cron" ? <Field><FieldLabel htmlFor="schedule-cron">{t("generic.schedule.expression")}</FieldLabel><Input disabled={disabled} id="schedule-cron" value={value.cron} onChange={event => update(event.target.value)} placeholder="0 9 * * *" /></Field> : <Field><FieldLabel>{t("generic.schedule.time")}</FieldLabel><TimePicker disabled={disabled} labels={{ hour: t("generic.schedule.hour"), minute: t("generic.schedule.minute") }} value={`${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`} onChange={time => { const [hour, minute] = time.split(":"); update(`${Number(minute)} ${Number(hour)} * * ${preset === "weekly" ? weekday : "*"}`); }} /></Field>}
    {preset === "weekly" && <Field><FieldLabel>{t("generic.schedule.weekday")}</FieldLabel><Select disabled={disabled} value={weekday} onValueChange={day => update(`${minute} ${hour} * * ${day}`)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{[0, 1, 2, 3, 4, 5, 6].map(day => <SelectItem key={day} value={String(day)}>{t(`generic.schedule.days.${day}`)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>}
    <Field className={preset !== "weekly" ? "sm:col-span-2" : undefined}><FieldLabel>{t("generic.schedule.timeZone")}</FieldLabel><Select disabled={disabled} value={value.timeZone} onValueChange={zone => update(value.cron, zone)}><SelectTrigger aria-label={t("generic.schedule.timeZone")}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{[...new Set([value.timeZone, "UTC", ...Intl.supportedValuesOf("timeZone")])].filter(Boolean).map(zone => <SelectItem key={zone} value={zone}>{zone}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>

  </FieldGroup>;
}
