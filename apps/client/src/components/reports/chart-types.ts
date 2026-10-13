import { ChartColumn, ChartBar, ChartLine, ChartArea, ChartPie, Circle, Radar, ChartNoAxesCombined, ChartScatter, Funnel, PanelsTopLeft } from "lucide-react";
import type { ReportChartType } from "@tabdo/shared";
import i18n from "@/i18n";

const CHART_ICONS: Record<ReportChartType, typeof ChartColumn> = {
  bar: ChartColumn,
  "bar-horizontal": ChartBar,
  line: ChartLine,
  area: ChartArea,
  pie: ChartPie,
  donut: Circle,
  radar: Radar,
  radial: ChartNoAxesCombined,
  scatter: ChartScatter,
  funnel: Funnel,
  treemap: PanelsTopLeft,
};

const CHART_IDS = Object.keys(CHART_ICONS) as ReportChartType[];

/** Chart option labels in the current i18n language. */
export function reportChartOptions(): { id: ReportChartType; name: string; icon: typeof ChartColumn }[] {
  return CHART_IDS.map((id) => ({
    id,
    name: i18n.t(`reports:charts.${id}`),
    icon: CHART_ICONS[id],
  }));
}
