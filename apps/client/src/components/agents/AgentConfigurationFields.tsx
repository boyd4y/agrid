import { BookOpen, Lock, Monitor, Cloud, X } from "lucide-react";
import type { SkillSummary } from "@tabdo/shared";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@tabdo/ui/components/field";
import { Card, CardHeader, CardTitle, CardDescription } from "@tabdo/ui/components/card";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Textarea } from "@tabdo/ui/components/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@tabdo/ui/components/select";
import { HarnessLogo } from "@/components/icons/HarnessLogos";
import { SkillPicker } from "@/components/skills/SkillPicker";
import type { HarnessId } from "@/lib/harness";
import { AvatarPicker } from "@/components/members/AvatarPicker";
import { useTranslation } from "react-i18next";

export type HarnessStatus = { id: HarnessId; label: string; available: boolean; models: { id: string; label: string }[]; defaultModel: string; provider?: string; hint?: string; runtimeModes: ("local" | "sandbox")[]; defaultRuntime: "local" | "sandbox" };
export type AgentBasicValues = { name: string; image: string | null; persona: string; harness: HarnessId; model: string; runtime: "local" | "sandbox" };

export function AgentBasicFields({ value, onChange, harnesses, harnessLocked, disabled, onAvatarProcessingChange }: {
  value: AgentBasicValues;
  onChange: (patch: Partial<AgentBasicValues>) => void;
  harnesses: HarnessStatus[];
  harnessLocked: boolean;
  disabled?: boolean;
  onAvatarProcessingChange?: (processing: boolean) => void;
}) {
  const { t } = useTranslation("agents");
  const current = harnesses.find((harness) => harness.id === value.harness);
  const customModel = !current?.models.some((model) => model.id === value.model);
  return <FieldGroup>
    <AvatarPicker name={value.name || t("agent")} image={value.image} kind="agent" onChange={(image) => onChange({ image })} disabled={disabled} onProcessingChange={onAvatarProcessingChange} />
    <Field>
      <FieldLabel htmlFor="agentName">{t("name")}</FieldLabel>
      <Input id="agentName" required maxLength={100} value={value.name} onChange={(e) => onChange({ name: e.target.value })} placeholder={t("namePlaceholder")} />
    </Field>
    <Field>
      <FieldLabel htmlFor="persona">{t("persona")}</FieldLabel>
      <Textarea id="persona" required maxLength={20_000} value={value.persona} onChange={(e) => onChange({ persona: e.target.value })} rows={5} placeholder={t("personaPlaceholder")} />
      <FieldDescription>{t("personaHint")}</FieldDescription>
    </Field>
    <FieldGroup className="@xl/field-group:grid @xl/field-group:grid-cols-2">
      <Field data-disabled={harnessLocked}>
        <FieldLabel htmlFor="agent-harness">Harness</FieldLabel>
        <Select value={value.harness} disabled={harnessLocked} onValueChange={(id) => {
          const selected = harnesses.find((item) => item.id === id);
          onChange({ harness: id as HarnessId, model: selected?.defaultModel ?? "__harness_default__", runtime: selected?.defaultRuntime ?? "sandbox" });
        }}>
          <SelectTrigger id="agent-harness"><SelectValue placeholder={t("pickHarness")}>{current && <span className="flex items-center gap-2"><HarnessLogo id={current.id} />{current.label}</span>}</SelectValue></SelectTrigger>
          <SelectContent><SelectGroup>{harnesses.map((item) => <SelectItem key={item.id} value={item.id}><HarnessLogo id={item.id} />{item.label}{!item.available && t("notConfigured")}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
        <FieldDescription><Lock className="mr-1 inline size-3" />{t("harnessLocked")}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="agent-model">{t("model")}</FieldLabel>
        <Select value={customModel ? "__custom_model__" : value.model} onValueChange={(id) => onChange({ model: id === "__custom_model__" ? "" : id })}>
          <SelectTrigger id="agent-model"><SelectValue placeholder={t("pickModel")} /></SelectTrigger>
          <SelectContent><SelectGroup>{(current?.models ?? []).map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}<SelectItem value="__custom_model__">{t("customModel")}</SelectItem></SelectGroup></SelectContent>
        </Select>
        <FieldDescription>{t("modelHint")}</FieldDescription>
      </Field>
    </FieldGroup>
    {customModel && <Field>
      <FieldLabel htmlFor="agent-custom-model">{t("modelId")}</FieldLabel>
      <Input id="agent-custom-model" required maxLength={200} value={value.model} onChange={(event) => onChange({ model: event.target.value })} placeholder={t("modelIdPlaceholder")} />
    </Field>}
    <Field>
      <FieldLabel htmlFor="agent-runtime">{t("runtime")}</FieldLabel>
      <Select value={value.runtime} onValueChange={(mode) => onChange({ runtime: mode as "local" | "sandbox" })}>
        <SelectTrigger id="agent-runtime" data-testid="agent-runtime-select"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>{(current?.runtimeModes ?? ["local", "sandbox"]).map((mode) => <SelectItem key={mode} value={mode}>{mode === "local" ? <Monitor /> : <Cloud />}{mode === "local" ? t("runtimeLocal") : "Sandbox"}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
      <FieldDescription>{value.runtime === "local" ? t("runtimeLocalDesc") : t("runtimeSandboxDesc")} {t("runtimeChangeHint")}</FieldDescription>
      {!current?.available && current?.hint && <FieldDescription>{current.hint}</FieldDescription>}
    </Field>
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
    {chosen.map((skill) => <Card key={skill.id} variant="flat" padding="sm" data-testid={`agent-selected-skill-${skill.name}`}>
      <CardHeader className="mb-0 flex-row items-start gap-3">
        <BookOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-2"><CardTitle>{skill.name}</CardTitle><CardDescription>{skill.description}</CardDescription></div>
        <Button type="button" size="icon" variant="ghost" disabled={disabled} aria-label={t("removeSkill", { name: skill.name })} onClick={() => onChange(selected.filter((name) => name !== skill.name))}><X data-icon="inline-start" /></Button>
      </CardHeader>
    </Card>)}
    {!chosen.length && <FieldDescription>{skills.some((skill) => skill.enabled) ? t("noSkillsYet") : t("noSkillsEnabled")}</FieldDescription>}
  </div>;
}
