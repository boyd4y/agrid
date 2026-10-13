import { ChartColumn, ChartBar, ChartLine, ChartArea, ChartPie, Circle, Radar, ChartNoAxesCombined, ChartScatter, Funnel, PanelsTopLeft } from "lucide-react";
import type { ReportChartType } from "@tabdo/shared";
export const REPORT_CHART_OPTIONS: { id: ReportChartType; name: string; icon: typeof ChartColumn }[] = [
  { id: "bar", name: "柱状图", icon: ChartColumn },
  { id: "bar-horizontal", name: "条形图", icon: ChartBar },
  { id: "line", name: "折线图", icon: ChartLine },
  { id: "area", name: "面积图", icon: ChartArea },
  { id: "pie", name: "饼图", icon: ChartPie },
  { id: "donut", name: "环形图", icon: Circle },
  { id: "radar", name: "雷达图", icon: Radar },
  { id: "radial", name: "径向条形图", icon: ChartNoAxesCombined },
  { id: "scatter", name: "散点图", icon: ChartScatter },
  { id: "funnel", name: "漏斗图", icon: Funnel },
  { id: "treemap", name: "矩形树图", icon: PanelsTopLeft },
];
