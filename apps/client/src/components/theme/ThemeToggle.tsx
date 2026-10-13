import { Monitor, Moon, Sun } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useTheme, type Theme } from "./theme-provider";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { SIDEBAR_ICON, SIDEBAR_ROW } from "@/components/shell/sidebar-styles";

export function ThemeToggle({ expanded = false, sidebar = false }: { expanded?: boolean; sidebar?: boolean }) {
  const { t } = useTranslation("app");
  const { theme, setTheme } = useTheme();
  const options = [
    { value: "light" as const, label: t("theme.light"), icon: Sun },
    { value: "dark" as const, label: t("theme.dark"), icon: Moon },
    { value: "system" as const, label: t("theme.system"), icon: Monitor },
  ];
  const current = options.find((option) => option.value === theme)!;
  const Icon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={expanded ? "sm" : "icon"}
          className={cn(sidebar ? [SIDEBAR_ROW, "h-auto w-full justify-start font-normal text-muted-foreground", !expanded && "justify-center px-2"] : expanded && "w-full justify-start px-2.5")}
          aria-label={t("shell.themeCurrent", { label: current.label })}
          title={t("shell.themeTitle", { label: current.label })}
        >
          <Icon data-icon="inline-start" className={sidebar ? SIDEBAR_ICON : undefined} />
          {expanded && <span className="truncate">{t("shell.theme")} · {current.label}</span>}
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
