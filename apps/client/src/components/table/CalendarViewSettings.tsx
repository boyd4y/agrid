import { useState } from "react";
import { Settings2, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CalendarViewConfig, TableView } from "@tabdo/shared";
import { Button } from "@tabdo/ui/components/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@tabdo/ui/components/field";
import { Popover, PopoverContent, PopoverTrigger } from "@tabdo/ui/components/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@tabdo/ui/components/select";
import { api } from "@/lib/api";
import type { FullTable } from "@/types/table";

type Props = { table: FullTable; view?: TableView; onSaved: (view: TableView) => void; onClose?: () => void; initiallyOpen?: boolean };
export function CalendarViewSettings({ table, view, onSaved, onClose, initiallyOpen = false }: Props) {
  const { t } = useTranslation("table");
  const [open, setOpen] = useState(initiallyOpen), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const initial = (): CalendarViewConfig => view ? view.config as CalendarViewConfig : { startColumnId: "", endMode: "inclusive", titleColumnId: table.columns.find(col => col.type === "text" && !col.config.hidden)?.id ?? null };
  const [draft, setDraft] = useState<CalendarViewConfig>(initial);
  const changeOpen = (value: boolean) => { if (busy) return; setOpen(value); setError(""); if (value) setDraft(initial()); else onClose?.(); };
  const fields = [["startColumnId", "date"], ["endColumnId", "date"], ["titleColumnId", "text"], ["personColumnId", "person"]] as const;
  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild><Button variant="outline" size="sm" data-testid="calendar-mapping-trigger"><Settings2 />{t(view ? "calendarView.mapping" : "calendarView.add")}</Button></PopoverTrigger>
    <PopoverContent align="end" className="max-h-[var(--radix-popover-content-available-height)] w-80 overflow-y-auto overscroll-contain" data-testid="calendar-mapping" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <form noValidate onSubmit={async event => {
        event.preventDefault(); if (!draft.startColumnId || busy) return;
        setBusy(true); setError("");
        try { const saved = view ? await api.updateCalendarView({ viewId: view.id, config: draft }) : await api.createCalendarView({ tableId: table.id, name: t("calendarView.name"), config: draft }); onSaved(saved); setOpen(false); onClose?.(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : t("saveFailed")); }
        finally { setBusy(false); }
      }}><FieldGroup>
        <p className="text-sm font-medium">{t("calendarView.mapping")}</p>
        <p className="text-xs text-muted-foreground">{t("calendarView.mappingHint")}</p>
        {fields.map(([field, type]) => {
          const options = table.columns.filter(col => col.type === type && !col.config.hidden);
          const selected = draft[field], unavailable = selected && !options.some(col => col.id === selected);
          return <Field key={field}><FieldLabel htmlFor={`calendar-${field}`}>{t(`calendarView.${field}`)}</FieldLabel>
            <Select value={selected || "none"} disabled={busy} onValueChange={value => setDraft({ ...draft, [field]: value === "none" ? field === "startColumnId" ? "" : null : value })}>
              <SelectTrigger id={`calendar-${field}`}><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="none">{t(field === "startColumnId" ? "calendarView.chooseStart" : "calendarView.none")}</SelectItem>
                {unavailable && <SelectItem value={selected} disabled>{t("calendarView.unavailableField")}</SelectItem>}
                {options.map(col => <SelectItem key={col.id} value={col.id} disabled={field === "endColumnId" && col.id === draft.startColumnId}>{col.name}{options.filter(option => option.name === col.name).length > 1 ? ` · ${col.id.slice(0, 8)}` : ""}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>;
        })}
        <Field><FieldLabel htmlFor="calendar-end-mode">{t("calendarView.endMode")}</FieldLabel><Select value={draft.endMode ?? "inclusive"} disabled={busy} onValueChange={value => setDraft({ ...draft, endMode: value as CalendarViewConfig["endMode"] })}><SelectTrigger id="calendar-end-mode"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="inclusive">{t("calendarView.inclusive")}</SelectItem><SelectItem value="exclusive">{t("calendarView.exclusive")}</SelectItem></SelectGroup></SelectContent></Select><FieldDescription>{t("calendarView.endHint")}</FieldDescription></Field>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => changeOpen(false)}>{t("cancel")}</Button><Button type="submit" disabled={busy || !draft.startColumnId}><Save />{t(busy ? "saving" : "save")}</Button></div>
      </FieldGroup></form>
    </PopoverContent>
  </Popover>;
}
