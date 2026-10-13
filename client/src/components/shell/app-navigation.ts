import { NiGrid, NiSparkles, NiUsers, NiZap } from "@/components/icons";
import { BookOpen, ChartNoAxesCombined, Settings } from "lucide-react";

/** Sidebar and page headers share the same menu names and icon components. */
export const APP_NAVIGATION = {
  ai: { to: "/app", label: "AI", icon: NiSparkles },
  tables: { to: "/app/tables", label: "表格", icon: NiGrid },
  automations: { to: "/app/automations", label: "自动化", icon: NiZap },
  reports: { to: "/app/reports", label: "报告", icon: ChartNoAxesCombined },
  members: { to: "/app/members", label: "成员", icon: NiUsers },
  agents: { to: "/app/agents", label: "智能体", icon: NiSparkles },
  skills: { to: "/app/skills", label: "Skill", icon: BookOpen },
  settings: { to: "/app/settings", label: "设置", icon: Settings },
} as const;

export type AppPageKey = keyof typeof APP_NAVIGATION;
