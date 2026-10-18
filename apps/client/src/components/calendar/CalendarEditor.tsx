import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Calendar } from "@tabdo/shared";
import { calendarCommand } from "@/lib/calendar-api";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@tabdo/ui/components/field";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@tabdo/ui/components/dialog";

const key = () => crypto.randomUUID();
export function CalendarEditor({ calendar, onClose, onSaved }: { calendar?: Calendar; onClose(): void; onSaved(calendar: Calendar): Promise<void> }) {
  const { t } = useTranslation("calendar");
  const [name, setName] = useState(calendar?.name ?? ""), [zone, setZone] = useState(calendar?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const busy = useRef(false);
  const retry = useRef({ hash: "", key: key() });
  return <Dialog open onOpenChange={open => { if (!open && !busy.current) onClose(); }}><DialogContent closeLabel={t("close")} className="max-h-[calc(100dvh-2rem)] overflow-y-auto"><DialogHeader><DialogTitle>{t(calendar ? "editCalendar" : "newCalendar")}</DialogTitle><DialogDescription>{t("calendarHint")}</DialogDescription></DialogHeader>
    <form noValidate className="flex flex-col gap-5" onSubmit={async e => {
      e.preventDefault(); if (busy.current) return;
      const hash = JSON.stringify([name, zone]); if (retry.current.hash !== hash) retry.current = { hash, key: key() };
      busy.current = true; setPending(true); setError("");
      try { const input = { name, timeZone: zone, idempotencyKey: retry.current.key }; const saved = calendar ? await calendarCommand("updateCalendar", { ...input, calendarId: calendar.id, expectedVersion: calendar.version }) : await calendarCommand("createCalendar", input); await onSaved(saved); onClose(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : t("errors.REQUEST_FAILED")); } finally { busy.current = false; setPending(false); }
    }}><FieldGroup><Field><FieldLabel htmlFor="calendar-name">{t("name")}</FieldLabel><Input id="calendar-name" value={name} required maxLength={200} disabled={pending} onChange={e => setName(e.target.value)} /></Field><Field><FieldLabel htmlFor="calendar-zone">{t("timeZone")}</FieldLabel><Input id="calendar-zone" value={zone} required disabled={pending} onChange={e => setZone(e.target.value)} placeholder="Asia/Shanghai" /></Field></FieldGroup>{error && <FieldError role="alert">{error}</FieldError>}<Button disabled={pending || !name.trim()}>{t(pending ? "saving" : "save")}</Button></form>
  </DialogContent></Dialog>;
}
