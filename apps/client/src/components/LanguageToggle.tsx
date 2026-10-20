import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@tabdo/ui/components/dropdown-menu";
import { setAppLocale } from "@/i18n";

export function LanguageToggle() {
  const { t, i18n } = useTranslation("common");
  const locale = i18n.language.startsWith("en") ? "en" : "zh-CN";
  const options = [
    { value: "zh-CN", label: t("languageZh") },
    { value: "en", label: t("languageEn") },
  ];
  const current = options.find((option) => option.value === locale)!;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t("languageCurrent", { label: current.label })}>
          {current.label}
          <ChevronDown data-icon="inline-end" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label={t("language")}>
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup value={locale} onValueChange={(value) => {
            if (value === "zh-CN" || value === "en") void setAppLocale(value);
          }}>
            {options.map(({ value, label }) => (
              <DropdownMenuRadioItem key={value} value={value} lang={value}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
