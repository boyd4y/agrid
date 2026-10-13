import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { Keyboard, Moon, Sun, Monitor, Languages } from "lucide-react";
import { useAppShell } from "@/context/AppShellContext";
import { Card, CardHeader, CardTitle, CardContent } from "@tabdo/ui/components/card";
import { Field, FieldGroup, FieldLabel } from "@tabdo/ui/components/field";
import { Switch } from "@tabdo/ui/components/switch";
import { ToggleGroup, ToggleGroupItem } from "@tabdo/ui/components/toggle-group";
import { useTheme, type Theme } from "@/components/theme/theme-provider";
import { useTranslation } from "react-i18next";
import { setAppLocale, type AppLocale } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { ApiKeysSettings } from "@/components/settings/ApiKeysSettings";

export function SettingsPage() {
  const { t, i18n } = useTranslation(["app", "common"]);
  const { sidebarCollapsed, setSidebarCollapsed, aiOpen, setAiOpen } = useAppShell();
  const { theme, setTheme } = useTheme();
  const { user, session } = useAuth();
  const locale = (i18n.language?.startsWith("en") ? "en" : "zh-CN") as AppLocale;
  const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? t("common:modKey")
    : t("common:modKeyCtrl");

  const themeOptions: { id: Theme; label: string; icon: typeof Sun }[] = [
    { id: "light", label: t("theme.light"), icon: Sun },
    { id: "dark", label: t("theme.dark"), icon: Moon },
    { id: "system", label: t("theme.system"), icon: Monitor },
  ];

  return <AppPage contentWidth="standard" className="gap-4" header={<AppPageHeader page="settings" description={t("settings.description")} />}>
    <Card className="shrink-0">
      <CardHeader><CardTitle>{t("settings.appearance")}</CardTitle></CardHeader>
      <CardContent>
        <ToggleGroup type="single" variant="outline" size="sm" value={theme} onValueChange={(value) => { if (value) setTheme(value as Theme); }} aria-label={t("settings.appearanceAria")} className="flex-wrap justify-start gap-2">
          {themeOptions.map(({ id, label, icon: Icon }) => <ToggleGroupItem key={id} value={id} aria-label={label}><Icon aria-hidden />{label}</ToggleGroupItem>)}
        </ToggleGroup>
      </CardContent>
    </Card>
    <Card className="shrink-0">
      <CardHeader><CardTitle className="flex items-center gap-2"><Languages aria-hidden className="size-4" />{t("settings.language")}</CardTitle></CardHeader>
      <CardContent>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={locale}
          onValueChange={(value) => { if (value) void setAppLocale(value as AppLocale); }}
          aria-label={t("settings.languageAria")}
          className="flex-wrap justify-start gap-2"
        >
          <ToggleGroupItem value="zh-CN" aria-label={t("common:languageZh")}>{t("common:languageZh")}</ToggleGroupItem>
          <ToggleGroupItem value="en" aria-label={t("common:languageEn")}>{t("common:languageEn")}</ToggleGroupItem>
        </ToggleGroup>
      </CardContent>
    </Card>
    <Card className="shrink-0">
      <CardHeader><CardTitle>{t("settings.layout")}</CardTitle></CardHeader>
      <CardContent><FieldGroup>
        <Field orientation="horizontal"><FieldLabel htmlFor="settings-sidebar">{t("settings.collapseNav")}</FieldLabel><Switch id="settings-sidebar" aria-label={t("settings.collapseNav")} checked={sidebarCollapsed} onCheckedChange={setSidebarCollapsed} /></Field>
        <Field orientation="horizontal"><FieldLabel htmlFor="settings-ai">{t("settings.defaultAiDrawer")}</FieldLabel><Switch id="settings-ai" aria-label={t("settings.defaultAiDrawer")} checked={aiOpen} onCheckedChange={setAiOpen} /></Field>
      </FieldGroup></CardContent>
    </Card>
    {user && user.kind !== "agent" && <ApiKeysSettings key={`${user.id}:${session?.activeOrganizationId ?? ""}`} />}
    <Card className="shrink-0">
      <CardHeader><CardTitle className="flex items-center gap-2"><Keyboard aria-hidden className="size-4" />{t("settings.shortcuts")}</CardTitle></CardHeader>
      <CardContent><ul className="flex flex-col gap-2 text-sm text-muted-foreground">
        <li className="flex justify-between gap-3"><span>{t("settings.shortcutSidebar")}</span><kbd className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs ring-1 ring-border">{mod} \\</kbd></li>
        <li className="flex justify-between gap-3"><span>{t("settings.shortcutAi")}</span><kbd className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs ring-1 ring-border">{mod} J</kbd></li>
      </ul></CardContent>
    </Card>
  </AppPage>;
}
