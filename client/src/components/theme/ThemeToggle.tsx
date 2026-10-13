import { Monitor, Moon, Sun } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={expanded ? "sm" : "icon"}
          className={cn(expanded && "w-full justify-start px-2.5")}
          aria-label={`切换外观，当前${current.label}`}
          title={`外观：${current.label}`}
        >
          <Icon data-icon="inline-start" />
          {expanded && <span>外观 · {current.label}</span>}
        </Button>
      </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup><DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
            {options.map(({ value, label, icon: OptionIcon }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <OptionIcon />
                <span className="flex-1">{label}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup></DropdownMenuGroup>
        </DropdownMenuContent>
    </DropdownMenu>
  );
}
