import { Check, Monitor, Moon, Sun } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { Button } from "@/components/ui/button";
import { useTheme, type Theme } from "./theme-provider";
import { cn } from "@/lib/utils";

const options = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
] as const;

export function ThemeToggle({ expanded = false }: { expanded?: boolean }) {
  const { theme, setTheme } = useTheme();
  const current = options.find((option) => option.value === theme)!;
  const Icon = current.icon;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          size={expanded ? "sm" : "icon"}
          className={cn("text-muted-foreground", expanded && "w-full justify-start px-2.5")}
          aria-label={`切换外观，当前${current.label}`}
          title={`外观：${current.label}`}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {expanded && <span className="ml-1 text-sm">外观 · {current.label}</span>}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content sideOffset={6} align="end" className="popover-surface z-[100] min-w-40 rounded-lg border bg-popover p-1 text-popover-foreground">
          <DropdownMenu.RadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
            {options.map(({ value, label, icon: OptionIcon }) => (
              <DropdownMenu.RadioItem key={value} value={value} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground">
                <OptionIcon className="h-4 w-4" />
                <span className="flex-1">{label}</span>
                <DropdownMenu.ItemIndicator><Check className="h-4 w-4" /></DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
