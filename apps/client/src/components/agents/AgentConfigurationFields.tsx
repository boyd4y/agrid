import { BookOpen, Monitor, Cloud, X } from "lucide-react";
import type { SkillSummary, SandboxProvider, RuntimeProviderStatus } from "@tabdo/shared";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@tabdo/ui/components/field";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Textarea } from "@tabdo/ui/components/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@tabdo/ui/components/select";
import { SkillPicker } from "@/components/skills/SkillPicker";
import type { HarnessId } from "@/lib/harness";
import { AvatarPicker } from "@/components/members/AvatarPicker";
import { useTranslation } from "react-i18next";

export type HarnessStatus = { id: HarnessId; label: string; available: boolean; models: { id: string; label: string }[]; defaultModel: string; provider?: string; hint?: string; runtimeProviders?: RuntimeProviderStatus[]; runtimeModes: ("local" | "sandbox")[]; defaultRuntime: "local" | "sandbox" };
export type AgentBasicValues = { name: string; image: string | null; persona: string; harness: HarnessId; model: string; runtime: "local" | "sandbox"; sandboxProvider: SandboxProvider };

export function AgentBasicFields({ value, onChange, harnesses, disabled, onAvatarProcessingChange }: {
  value: AgentBasicValues;
  onChange: (patch: Partial<AgentBasicValues>) => void;
  harnesses: HarnessStatus[];
  harnessLocked?: boolean;
  disabled?: boolean;
  onAvatarProcessingChange?: (processing: boolean) => void;
}) {
  const { t } = useTranslation("agents");
  const current = harnesses.find((harness) => harness.id === value.harness);
  const selectedProvider = current?.runtimeProviders?.find(entry => entry.id === value.sandboxProvider);
  const availableModes = (current?.runtimeModes ?? []).filter(mode => current?.runtimeProviders?.some(
    entry => entry.available && (mode === "local" ? entry.id === "local" : entry.id !== "local"),
  ));
  const providerOptions = current?.runtimeProviders?.filter(entry =>
    entry.id !== "local" && (entry.available || entry.id === value.sandboxProvider),
  ) ?? [];
  return <FieldGroup className="gap-4">
    <FieldGroup className="gap-4 @lg/field-group:grid @lg/field-group:grid-cols-[auto_1fr]">
    <AvatarPicker name={value.name || t("agent")} image={value.image} kind="agent" onChange={(image) => onChange({ image })} disabled={disabled} onProcessingChange={onAvatarProcessingChange} />
    <Field className="gap-2">
      <FieldLabel htmlFor="agentName">{t("name")}</FieldLabel>
      <Input id="agentName" required maxLength={100} value={value.name} onChange={(e) => onChange({ name: e.target.value })} placeholder={t("namePlaceholder")} />
    </Field>
    </FieldGroup>
    <Field className="gap-2">
      <FieldLabel htmlFor="persona">{t("persona")}</FieldLabel>
      <Textarea id="persona" required maxLength={20_000} value={value.persona} onChange={(e) => onChange({ persona: e.target.value })} rows={4} placeholder={t("personaPlaceholder")} />
    </Field>
    {availableModes.length > 1 && <Field className="gap-2">
      <FieldLabel htmlFor="agent-runtime">{t("runtime")}</FieldLabel>
      <Select value={value.runtime} onValueChange={(mode) => { if (mode === "local" || mode === "sandbox") onChange({ runtime: mode }); }}>
        <SelectTrigger id="agent-runtime" data-testid="agent-runtime-select"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>{availableModes.map((mode) => <SelectItem key={mode} value={mode} disabled={mode === "local" && current?.runtimeProviders?.find(entry => entry.id === "local")?.available === false}>{mode === "local" ? <Monitor /> : <Cloud />}{mode === "local" ? t("runtimeLocal") : "Sandbox"}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
      <FieldDescription>{t("runtimeChangeHint")}</FieldDescription>
      {!current?.available && current?.hint && <FieldDescription>{current.hint}</FieldDescription>}
    </Field>}
    {value.runtime === "sandbox" && providerOptions.length > 1 && <Field className="gap-2">
      <FieldLabel htmlFor="agent-sandbox-provider">{t("sandboxProvider")}</FieldLabel>
      <Select value={value.sandboxProvider} onValueChange={(id) => { if (id === "vercel" || id === "e2b" || id === "railway") onChange({ sandboxProvider: id }); }}>
        <SelectTrigger id="agent-sandbox-provider" data-testid="agent-sandbox-provider-select"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>{providerOptions.map(({ id, available }) => {
          return <SelectItem key={id} value={id} disabled={!available}>{id === "e2b" ? "E2B" : id === "railway" ? "Railway" : "Vercel"}{!available && t("providerUnavailable")}</SelectItem>;
        })}</SelectGroup></SelectContent>
      </Select>
      <FieldDescription>{t("sandboxProviderHint")}</FieldDescription>
    </Field>}
    {value.runtime === "sandbox" && <>
      {value.sandboxProvider === "railway" && <FieldDescription>{t("railwayLifecycleHint")}</FieldDescription>}
      {value.sandboxProvider === "railway" && selectedProvider?.available === false && <FieldDescription>{selectedProvider.reason === "railway_harness_unavailable" ? t("railwayHarnessUnavailable") : selectedProvider.hint}</FieldDescription>}
      {value.sandboxProvider === "e2b" && value.harness !== "pi" && <FieldDescription>{t("e2bBridgeUnavailable")}</FieldDescription>}
    </>}
    {value.runtime === "local" && <FieldDescription>{t("runtimeLocalTrust")}</FieldDescription>}
  </FieldGroup>;
}

export function AgentSkillFields({ skills, selected, onChange, disabled }: {
  skills: SkillSummary[];
  selected: string[];
  onChange: (names: string[]) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation("agents");
  const chosen = skills.filter((skill) => skill.enabled && selected.includes(skill.name));
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <FieldDescription>{t("skillsSelected", { count: chosen.length })}</FieldDescription>
      <SkillPicker skills={skills} selected={chosen.map((skill) => skill.name)} onChange={onChange} disabled={disabled} />
    </div>
    {chosen.length > 0 && <ul className="divide-y divide-border">{chosen.map((skill) => <li key={skill.id} className="py-3" data-testid={`agent-selected-skill-${skill.name}`}>
      <div className="flex items-start gap-3">
        <BookOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-2"><h3 className="text-sm font-medium">{skill.name}</h3><p className="text-sm text-muted-foreground">{skill.description}</p></div>
        <Button type="button" size="icon" variant="ghost" disabled={disabled} aria-label={t("removeSkill", { name: skill.name })} onClick={() => onChange(selected.filter((name) => name !== skill.name))}><X data-icon="inline-start" /></Button>
      </div>
    </li>)}</ul>}
    {!chosen.length && <FieldDescription>{skills.some((skill) => skill.enabled) ? t("noSkillsYet") : t("noSkillsEnabled")}</FieldDescription>}
  </div>;
}
