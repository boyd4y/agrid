import { useTranslation } from "react-i18next";
import { Input } from "@tabdo/ui/components/input";
import { Checkbox } from "@tabdo/ui/components/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@tabdo/ui/components/field";
import type { IntegrationInbox } from "@tabdo/shared";

export function IntegrationCredentialsFields({ name, onName, apiKey, onApiKey, stored = false, disabled = false }: {
  name: string; onName: (value: string) => void; apiKey?: string; onApiKey?: (value: string) => void; stored?: boolean; disabled?: boolean;
}) {
  const { t } = useTranslation("integrations");
  return <FieldGroup><Field><FieldLabel htmlFor="integration-name">{t("name")}</FieldLabel><Input id="integration-name" value={name} placeholder={t("namePlaceholder")} maxLength={100} disabled={disabled} onChange={event => onName(event.target.value)} /></Field>{onApiKey && <Field><FieldLabel htmlFor="integration-key">{stored ? t("replaceKey") : t("apiKey")}</FieldLabel><Input id="integration-key" type="password" autoComplete="new-password" value={apiKey ?? ""} disabled={disabled} onChange={event => onApiKey(event.target.value)} /><FieldDescription>{t("keyHint")}</FieldDescription></Field>}</FieldGroup>;
}

export function IntegrationInboxSelection({ inboxes, selected, onChange, disabled = false }: {
  inboxes: IntegrationInbox[]; selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean;
}) {
  const { t } = useTranslation("integrations");
  return <FieldSet><FieldLegend>{t("inboxes")}</FieldLegend>{inboxes.length ? <FieldGroup data-slot="checkbox-group" className="max-h-60 overflow-y-auto">{inboxes.map(inbox => <Field key={inbox.inboxId} orientation="horizontal"><Checkbox id={`inbox-${inbox.inboxId}`} checked={selected.includes(inbox.inboxId)} disabled={disabled || (!selected.includes(inbox.inboxId) && selected.length >= 10)} onCheckedChange={checked => onChange(checked ? [...selected, inbox.inboxId] : selected.filter(id => id !== inbox.inboxId))} /><FieldLabel htmlFor={`inbox-${inbox.inboxId}`}><span className="flex min-w-0 flex-col gap-1"><span className="break-all">{inbox.displayName ?? inbox.address}</span>{inbox.displayName && <span className="break-all text-sm text-muted-foreground">{inbox.address}</span>}</span></FieldLabel></Field>)}</FieldGroup> : <FieldDescription>{t("noInboxes")}</FieldDescription>}<FieldDescription>{t("inboxLimit")}</FieldDescription></FieldSet>;
}
