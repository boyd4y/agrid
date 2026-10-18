import { useTranslation } from "react-i18next";
import { CardTitle } from "@tabdo/ui/components/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@tabdo/ui/components/tabs";
import { CalendarSubscriptionsSettings } from "@/components/settings/CalendarSubscriptionsSettings";
import { IntegrationsPage } from "@/pages/app/IntegrationsPage";

type Direction = "inbound" | "outbound";

export function WebhookSettings({ direction, onDirectionChange }: { direction: Direction; onDirectionChange(direction: Direction): void }) {
  const { t } = useTranslation("integrations");
  return <section className="flex min-w-0 flex-col gap-5" data-testid="webhook-settings">
    <CardTitle>Webhook</CardTitle>
    <Tabs activationMode="manual" value={direction} onValueChange={value => onDirectionChange(value as Direction)} className="min-w-0 gap-5">
      <TabsList aria-label={t("eventDirection")} className="grid h-auto min-h-9 w-full grid-cols-2 self-start sm:inline-flex sm:w-auto">
        <TabsTrigger value="inbound" className="whitespace-normal px-1 sm:px-3">{t("receiveEvents")}</TabsTrigger>
        <TabsTrigger value="outbound" className="whitespace-normal px-1 sm:px-3">{t("sendEvents")}</TabsTrigger>
      </TabsList>
      <TabsContent value="inbound" className="min-w-0"><IntegrationsPage kind="webhook" /></TabsContent>
      <TabsContent value="outbound" className="min-w-0"><CalendarSubscriptionsSettings /></TabsContent>
    </Tabs>
  </section>;
}
