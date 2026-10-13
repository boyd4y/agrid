import { Check, Plus } from "lucide-react";
import type { SkillSummary } from "@tabdo/shared";
import { Button } from "@tabdo/ui/components/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@tabdo/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@tabdo/ui/components/popover";
import { useTranslation } from "react-i18next";

export function SkillPicker({ skills, selected, onChange, disabled = false }: {
  skills: SkillSummary[];
  selected: string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("common");
  const available = skills.filter((skill) => skill.enabled);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled || !available.length} data-testid="agent-skill-picker">
          <Plus data-icon="inline-start" />{t("pickSkill")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end" aria-label={t("pickEnabledSkills")}>
        <Command>
          <CommandInput placeholder={t("searchSkills")} aria-label={t("searchEnabledSkills")} />
          <CommandList>
            <CommandEmpty>{t("noMatchingSkills")}</CommandEmpty>
            <CommandGroup heading={t("enabledSkillsHeading")}>
              {available.map((skill) => {
                const chosen = selected.includes(skill.name);
                return <CommandItem key={skill.id} value={skill.name} keywords={[skill.description]} disabled={disabled}
                  onSelect={() => onChange(chosen ? selected.filter((name) => name !== skill.name) : [...selected, skill.name])}>
                  <div className="flex min-w-0 flex-1 flex-col gap-1"><span>{skill.name}</span><span className="text-xs text-muted-foreground">{skill.description}</span></div>
                  {chosen && <><Check aria-hidden /><span className="sr-only">{t("selected")}</span></>}
                </CommandItem>;
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
