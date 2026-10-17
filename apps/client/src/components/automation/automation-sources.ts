import { Mail, Webhook } from "lucide-react";
import { APP_NAVIGATION } from "@/components/shell/app-navigation";

/** Source selectors, summaries and list rows use the same icons as their menus. */
export const AUTOMATION_SOURCE_ICONS = {
  calendar: APP_NAVIGATION.calendar.icon,
  table: APP_NAVIGATION.tables.icon,
  agentmail: Mail,
  webhook: Webhook,
  schedule: APP_NAVIGATION.schedules.icon,
};
