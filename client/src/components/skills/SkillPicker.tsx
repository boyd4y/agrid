import { Check, Plus } from "lucide-react";
import type { SkillSummary } from "@tabdo/shared";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function SkillPicker({ skills, selected, onChange, disabled = false }: {
  skills: SkillSummary[];
  selected: string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
}) {
  const available = skills.filter((skill) => skill.enabled);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled || !available.length} data-testid="agent-skill-picker">
          <Plus data-icon="inline-start" />选择 Skill
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end" aria-label="选择启用的技能">
        <Command>
          <CommandInput placeholder="搜索技能…" aria-label="搜索启用的技能" />
          <CommandList>
            <CommandEmpty>没有匹配的技能</CommandEmpty>
            <CommandGroup heading="已启用的技能">
              {available.map((skill) => {
                const chosen = selected.includes(skill.name);
                return <CommandItem key={skill.id} value={skill.name} keywords={[skill.description]} disabled={disabled}
                  onSelect={() => onChange(chosen ? selected.filter((name) => name !== skill.name) : [...selected, skill.name])}>
                  <div className="flex min-w-0 flex-1 flex-col gap-1"><span>{skill.name}</span><span className="text-xs text-muted-foreground">{skill.description}</span></div>
                  {chosen && <><Check aria-hidden /><span className="sr-only">已选择</span></>}
                </CommandItem>;
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
