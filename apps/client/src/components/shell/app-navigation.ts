import { NiBook, NiBot, NiGrid, NiUsers, NiZap, NiSettings, NiMessage, NiCalendar, NiClock, NiGlobe, NiPlug } from "@/components/icons";
import { ChartNoAxesCombined } from "lucide-react";

/** Sidebar and page headers share the same menu keys and icon components. Labels come from i18n `app:nav.*`. */
export const APP_NAVIGATION = {
  ai: { to: "/app", labelKey: "nav.ai", icon: NiMessage },
  tables: { to: "/app/tables", labelKey: "nav.tables", icon: NiGrid },
  automations: { to: "/app/automations", labelKey: "nav.automations", icon: NiZap, NiSettings, NiMessage, NiCalendar, NiClock, NiGlobe, NiPlug },
  calendar: { to: "/app/calendar", labelKey: "nav.calendar", icon: NiCalendar },
  schedules: { to: "/app/schedules", labelKey: "nav.schedules", icon: NiClock },
  sites: { to: "/app/sites", labelKey: "nav.sites", icon: NiGlobe },
  reports: { to: "/app/reports", labelKey: "nav.reports", icon: ChartNoAxesCombined },
  members: { to: "/app/members", labelKey: "nav.members", icon: NiUsers },
  agents: { to: "/app/agents", labelKey: "nav.agents", icon: NiBot },
  skills: { to: "/app/skills", labelKey: "nav.skills", icon: NiBook },
  integrations: { to: "/app/settings?tab=agentmail", labelKey: "nav.integrations", icon: NiPlug },
  settings: { to: "/app/settings", labelKey: "nav.settings", icon: NiSettings },
} as const;

export type AppPageKey = keyof typeof APP_NAVIGATION;
