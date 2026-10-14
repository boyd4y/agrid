import { useTranslation } from "react-i18next";
import { Input } from "@tabdo/ui/components/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@tabdo/ui/components/select";
import type { ReactNode } from "react";
import type { AutomationSource } from "@tabdo/shared";
export type EventField = { label?: string; path: string; type: "text" | "number" | "date" | "list" | "checkbox" };
export function automationEventFields(kind: AutomationSource["kind"]): EventField[] {
  const base: EventField[] = [{ path: "occurredAt", type: "date" }];
  if (kind === "table") return [{ path: "row.id", type: "text" }, { path: "row.tableId", type: "text" }, { path: "row.createdAt", type: "date" }, { path: "row.updatedAt", type: "date" }];
  if (kind === "agentmail") return [...base, ...["message.subject", "message.text", "message.html", "message.messageId", "message.inboxId", "message.threadId"].map(path => ({ path, type: "text" as const })), { path: "message.senders", type: "list" }, { path: "message.to", type: "list" }, { path: "message.bodyMissing", type: "checkbox" }, { path: "message.receivedAt", type: "date" }];
  if (kind === "schedule") return [...base, { path: "scheduledFor", type: "date" }, { path: "dispatchedAt", type: "date" }, { path: "delayed", type: "checkbox" }];
  return [...base, { path: "payload", type: "text" }];
}
function bindingMode(value: unknown) { return value && typeof value === "object" && "$event" in value ? "event" : value && typeof value === "object" && "$step" in value ? "step" : "literal"; }
export function BoundValueEditor({ value, onChange, literal, emptyValue = null, source, step, eventFields }: { value: unknown; onChange: (value: unknown) => void; literal: (value: unknown, onChange: (value: unknown) => void) => ReactNode; emptyValue?: unknown; source: AutomationSource; step: number; eventFields?: EventField[] }) {
  const { t } = useTranslation("automation"), mode = bindingMode(value);
  const fields = eventFields ?? automationEventFields(source.kind);
  const reference = value as { $event?: string; $step?: { index: number; path: string } } | null;
  return <div className="@container/binding min-w-0"><div className="grid min-w-0 gap-2 @xs/binding:grid-cols-[minmax(0,120px)_minmax(0,1fr)] @xs/binding:items-start">
    <Select value={mode} onValueChange={mode => onChange(mode === "literal" ? emptyValue : mode === "event" ? { $event: source.kind === "table" ? "row.id" : source.kind === "agentmail" ? "message.subject" : source.kind === "schedule" ? "scheduledFor" : "payload.value" } : { $step: { index: 0, path: "id" } })}><SelectTrigger aria-label={t("generic.valueSource")}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="literal">{t("generic.literal")}</SelectItem><SelectItem value="event">{t("generic.event")}</SelectItem>{step > 0 && <SelectItem value="step">{t("generic.previousStep")}</SelectItem>}</SelectGroup></SelectContent></Select>

    {mode === "literal" ? literal(value, onChange) : mode === "event" ? <><Select value={fields.some(field => field.path === reference?.$event) ? reference?.$event : "__custom__"} onValueChange={path => onChange({ $event: path === "__custom__" ? "" : path })}><SelectTrigger aria-label={t("generic.eventField")}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{fields.map(field => <SelectItem key={field.path} value={field.path}>{field.label ?? field.path}</SelectItem>)}<SelectItem value="__custom__">{t("generic.customPath")}</SelectItem></SelectGroup></SelectContent></Select>{!fields.some(field => field.path === reference?.$event) && <Input className="@xs/binding:col-span-2" aria-label={t("generic.eventPath")} value={reference?.$event ?? ""} onChange={event => onChange({ $event: event.target.value })} placeholder={source.kind === "webhook" ? "payload.customerId" : "row.id"} />}</> : <div className="flex gap-2"><Select value={String(reference?.$step?.index ?? 0)} onValueChange={index => onChange({ $step: { ...reference?.$step, index: Number(index) } })}><SelectTrigger aria-label={t("generic.previousStep")}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{Array.from({ length: step }, (_, index) => <SelectItem key={index} value={String(index)}>{t("generic.step", { index: index + 1 })}</SelectItem>)}</SelectGroup></SelectContent></Select><Input aria-label={t("generic.outputPath")} value={reference?.$step?.path ?? ""} onChange={event => onChange({ $step: { index: reference?.$step?.index ?? 0, path: event.target.value } })} /></div>}
  </div></div>;
}
