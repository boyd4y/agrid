import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { Keyboard, Moon, Sun, Monitor, Languages, Settings2, KeyRound, Plug } from "lucide-react";
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
import { IntegrationsPage } from "@/pages/app/IntegrationsPage";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@tabdo/ui/components/tabs";

export function SettingsPage() {
  const { t, i18n } = useTranslation(["app", "common"]);
  const { sidebarCollapsed, setSidebarCollapsed, aiOpen, setAiOpen } = useAppShell();
  const { theme, setTheme } = useTheme();
  const { user, session, isPending } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabs = [
    { id: "general", label: t("settings.tabs.general"), icon: Settings2 },
    ...(user && user.kind !== "agent" ? [{ id: "api-keys", label: t("settings.tabs.apiKeys"), icon: KeyRound }] : []),
    { id: "integrations", label: t("nav.integrations"), icon: Plug },
    { id: "shortcuts", label: t("settings.shortcuts"), icon: Keyboard },
  ];
  const requestedTab = searchParams.get("tab") ?? "general";
  const activeTab = tabs.some(tab => tab.id === requestedTab) ? requestedTab : "general";
  useEffect(() => {
    if (isPending || requestedTab === activeTab) return;
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      next.set("tab", "general");
      return next;
    }, { replace: true });
  }, [isPending, requestedTab, activeTab, setSearchParams]);
  const changeTab = (value: string) => setSearchParams(current => {
    const next = new URLSearchParams(current);
    next.set("tab", value);
    return next;
  });
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
    <Tabs orientation="vertical" activationMode="manual" value={activeTab} onValueChange={changeTab} className="min-w-0 flex-1 flex-row items-stretch gap-2 sm:gap-4 md:gap-6">
      <TabsList aria-label={t("settings.tabs.label")} className="h-auto w-10 shrink-0 flex-col items-stretch justify-start gap-1 self-start sm:w-28 md:w-[200px]">
        {tabs.map(({ id, label, icon: Icon }) => <TabsTrigger key={id} value={id} className="min-h-9 w-full justify-center px-1 sm:justify-start sm:px-2 md:px-3"><Icon aria-hidden /><span className="sr-only sm:not-sr-only">{label}</span></TabsTrigger>)}
      </TabsList>
      <TabsContent value="general" className="min-w-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col data-[state=active]:gap-4">
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
      </TabsContent>
      {user && user.kind !== "agent" && <TabsContent value="api-keys" className="min-w-0 flex-1"><ApiKeysSettings key={`${user.id}:${session?.activeOrganizationId ?? ""}`} /></TabsContent>}
      <TabsContent value="integrations" className="min-w-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col"><IntegrationsPage key={`${user?.id ?? ""}:${session?.activeOrganizationId ?? ""}`} embedded /></TabsContent>
      <TabsContent value="shortcuts" className="min-w-0 flex-1">
    <Card className="shrink-0">
      <CardHeader><CardTitle className="flex items-center gap-2"><Keyboard aria-hidden className="size-4" />{t("settings.shortcuts")}</CardTitle></CardHeader>
      <CardContent><ul className="flex flex-col gap-2 text-sm text-muted-foreground">
        <li className="flex justify-between gap-3"><span>{t("settings.shortcutSidebar")}</span><kbd className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs ring-1 ring-border">{mod} \\</kbd></li>
        <li className="flex justify-between gap-3"><span>{t("settings.shortcutAi")}</span><kbd className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs ring-1 ring-border">{mod} J</kbd></li>
      </ul></CardContent>
    </Card>
      </TabsContent>
    </Tabs>
  </AppPage>;
}
