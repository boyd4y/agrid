import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { AutomationRule, ScheduledOccurrence } from "@tabdo/shared";
import { api } from "@/lib/api";
import { ScheduleFields } from "@/components/automation/ScheduleFields";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Switch } from "@tabdo/ui/components/switch";
import { Badge } from "@tabdo/ui/components/badge";
import { Field, FieldGroup, FieldLabel, FieldError } from "@tabdo/ui/components/field";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@tabdo/ui/components/sheet";

export function ScheduledOccurrenceSheet({ occurrence, onClose, onSaved }: { occurrence: ScheduledOccurrence; onClose(): void; onSaved(): void }) {
  const { t, i18n } = useTranslation("calendar");
  const [rule, setRule] = useState<AutomationRule>(), [error, setError] = useState(""), [pending, setPending] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => { let active = true; setError(""); void api.getAutomation(occurrence.automationId).then(value => { if (active) setRule(value); }).catch(cause => { if (active) setError(cause.message); }); return () => { active = false; }; }, [occurrence.automationId, revision]);
  return <Sheet open onOpenChange={open => { if (!open && !pending) onClose(); }}><SheetContent className="overflow-y-auto"><SheetHeader><SheetTitle>{t("plans.title")}</SheetTitle><SheetDescription>{t("plans.hint")}</SheetDescription></SheetHeader>
    <div className="flex flex-col gap-4 p-4"><Badge variant="secondary" className="self-start">{t(`plans.${occurrence.projection}`)}</Badge><p className="text-sm">{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short", timeZone: occurrence.timeZone }).format(new Date(occurrence.scheduledFor))} · {occurrence.timeZone}</p>{occurrence.delayed && <p className="text-xs text-muted-foreground">{t("plans.delayed")}</p>}{occurrence.status && <p className="text-sm">{t(`reminders.status.${occurrence.status}`, { defaultValue: occurrence.status })}</p>}
      {occurrence.threadId && <Button asChild variant="outline" size="sm"><Link to={`/app/schedules/${occurrence.automationId}/runs/${occurrence.threadId}`}>{t("reminders.openRun")}</Link></Button>}
      {rule?.source.kind === "schedule" && <form noValidate onSubmit={async event => { event.preventDefault(); if (pending || rule.source.kind !== "schedule") return; setPending(true); setError(""); try { const saved = await api.updateAutomation(rule.id, { expectedVersion: rule.version, name: rule.name, source: rule.source, enabled: rule.enabled }); setRule(saved); onSaved(); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("errors.REQUEST_FAILED")); } finally { setPending(false); } }} className="flex flex-col gap-4"><fieldset disabled={pending} className="flex flex-col gap-4"><FieldGroup><Field><FieldLabel htmlFor="plan-name">{t("name")}</FieldLabel><Input id="plan-name" value={rule.name} onChange={event => setRule({ ...rule, name: event.target.value })} /></Field><Field orientation="horizontal"><Switch id="plan-enabled" checked={rule.enabled} onCheckedChange={enabled => setRule({ ...rule, enabled })} /><FieldLabel htmlFor="plan-enabled">{t("plans.enabled")}</FieldLabel></Field></FieldGroup><ScheduleFields value={rule.source} onChange={source => setRule({ ...rule, source })} /><Button type="submit" disabled={!rule.name.trim()}>{t(pending ? "saving" : "save")}</Button></fieldset></form>}
      {error && <><FieldError role="alert">{error}</FieldError><Button variant="outline" disabled={pending} onClick={() => setRevision(value => value + 1)}>{t("plans.reload")}</Button></>}
      <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>{t("close")}</Button>
    </div>
  </SheetContent></Sheet>;
}
