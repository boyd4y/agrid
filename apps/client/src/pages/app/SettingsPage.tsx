import { CalendarSubscriptionsSettings } from "@/components/settings/CalendarSubscriptionsSettings";
import { workspaceCacheKey } from "@/lib/workspace-scope";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { AppPage, AppPageHeader } from "@/components/shell/AppPage";
import { Moon, Sun, Monitor, Settings2, KeyRound, Mail, Webhook } from "lucide-react";
import { Card, CardTitle, CardDescription } from "@tabdo/ui/components/card";
import { Field, FieldGroup, FieldSet, FieldLegend } from "@tabdo/ui/components/field";
import { Separator } from "@tabdo/ui/components/separator";
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
  const { theme, setTheme } = useTheme();
  const { user, session, isPending } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabs = [
    { id: "general", label: t("settings.tabs.general"), icon: Settings2 },
    ...(user && user.kind !== "agent" ? [{ id: "api-keys", label: t("settings.tabs.apiKeys"), icon: KeyRound }] : []),
    { id: "agentmail", label: "AgentMail", icon: Mail },
    { id: "calendar-events", label: t("calendar:subscriptions.title"), icon: Webhook },
    { id: "webhook", label: "Webhook", icon: Webhook },
  ];
  const requestedTab = searchParams.get("tab") ?? "general";
  const normalizedTab = requestedTab === "integrations" ? "agentmail" : requestedTab === "site-api" ? "api-keys" : requestedTab;
  const activeTab = tabs.some(tab => tab.id === normalizedTab) ? normalizedTab : "general";
  useEffect(() => {
    if (isPending || requestedTab === activeTab) return;
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      next.set("tab", activeTab);
      return next;
    }, { replace: true });
  }, [isPending, requestedTab, activeTab, setSearchParams]);
  const changeTab = (value: string) => setSearchParams(current => {
    const next = new URLSearchParams(current);
    next.set("tab", value);
    return next;
  });
  const locale = (i18n.language?.startsWith("en") ? "en" : "zh-CN") as AppLocale;

  const themeOptions: { id: Theme; label: string; icon: typeof Sun }[] = [
    { id: "light", label: t("theme.light"), icon: Sun },
    { id: "dark", label: t("theme.dark"), icon: Moon },
    { id: "system", label: t("theme.system"), icon: Monitor },
  ];

  const paneClass = "min-w-0 flex-1 p-3 sm:p-6 data-[state=active]:flex data-[state=active]:flex-col data-[state=active]:gap-6";

  return <AppPage contentWidth="standard" header={<AppPageHeader page="settings" description={t("settings.description")} />}>
    <Card padding="none" className="min-w-0 overflow-hidden" data-testid="settings-frame">
      <Tabs orientation="vertical" activationMode="manual" value={activeTab} onValueChange={changeTab} className="min-h-[480px] min-w-0 flex-row items-stretch gap-0">
        <aside className="w-12 shrink-0 border-r p-1 sm:w-40 sm:p-3 md:w-[200px]">
          <TabsList variant="navigation" aria-label={t("settings.tabs.label")} className="h-auto w-full flex-col items-stretch justify-start gap-1">
            {tabs.map(({ id, label, icon: Icon }) => <TabsTrigger key={id} value={id} className="min-h-9 w-full justify-center px-1 sm:justify-start sm:px-2"><Icon aria-hidden /><span className="sr-only sm:not-sr-only">{label}</span></TabsTrigger>)}
          </TabsList>
        </aside>
        <TabsContent value="general" className={paneClass}>
          <header className="flex flex-col gap-2"><CardTitle>{t("settings.tabs.general")}</CardTitle><CardDescription>{t("settings.generalDescription")}</CardDescription></header>
          <FieldSet className="gap-3">
            <FieldLegend variant="label">{t("settings.appearance")}</FieldLegend>
            <FieldGroup><Field>
              <ToggleGroup type="single" variant="outline" size="sm" value={theme} onValueChange={(value) => { if (value) setTheme(value as Theme); }} aria-label={t("settings.appearanceAria")} className="flex-wrap justify-start gap-2">
                {themeOptions.map(({ id, label, icon: Icon }) => <ToggleGroupItem key={id} value={id} aria-label={label}><Icon aria-hidden />{label}</ToggleGroupItem>)}
              </ToggleGroup>
            </Field></FieldGroup>
          </FieldSet>
          <Separator />
          <FieldSet className="gap-3">
            <FieldLegend variant="label">{t("settings.language")}</FieldLegend>
            <FieldGroup><Field>
              <ToggleGroup type="single" variant="outline" size="sm" value={locale} onValueChange={(value) => { if (value) void setAppLocale(value as AppLocale); }} aria-label={t("settings.languageAria")} className="flex-wrap justify-start gap-2">
                <ToggleGroupItem value="zh-CN" aria-label={t("common:languageZh")}>{t("common:languageZh")}</ToggleGroupItem>
                <ToggleGroupItem value="en" aria-label={t("common:languageEn")}>{t("common:languageEn")}</ToggleGroupItem>
              </ToggleGroup>
            </Field></FieldGroup>
          </FieldSet>
        </TabsContent>
        {user && user.kind !== "agent" && <TabsContent value="api-keys" className={paneClass}><ApiKeysSettings key={`${user.id}:${session?.activeOrganizationId ?? ""}`} /></TabsContent>}
        <TabsContent value="agentmail" className={paneClass}><IntegrationsPage key={`${user?.id ?? ""}:${session?.activeOrganizationId ?? ""}:agentmail`} kind="agentmail" /></TabsContent>
        <TabsContent value="calendar-events" className={paneClass}><CalendarSubscriptionsSettings key={workspaceCacheKey()} /></TabsContent>
        <TabsContent value="webhook" className={paneClass}><IntegrationsPage key={`${user?.id ?? ""}:${session?.activeOrganizationId ?? ""}:webhook`} kind="webhook" /></TabsContent>
      </Tabs>
    </Card>
  </AppPage>;
}
