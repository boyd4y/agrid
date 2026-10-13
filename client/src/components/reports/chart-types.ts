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

/** Live chart option labels — reads current i18n language. */
export const REPORT_CHART_OPTIONS: { id: ReportChartType; name: string; icon: typeof ChartColumn }[] =
  new Proxy([] as { id: ReportChartType; name: string; icon: typeof ChartColumn }[], {
    get(_t, prop) {
      if (prop === "length") return CHART_IDS.length;
      if (prop === Symbol.iterator) {
        return function* () {
          for (const id of CHART_IDS) {
            yield { id, name: i18n.t(`reports:charts.${id}`), icon: CHART_ICONS[id] };
          }
        };
      }
      const idx = typeof prop === "string" && /^\d+$/.test(prop) ? Number(prop) : -1;
      if (idx >= 0 && idx < CHART_IDS.length) {
        const id = CHART_IDS[idx];
        return { id, name: i18n.t(`reports:charts.${id}`), icon: CHART_ICONS[id] };
      }
      // Array methods
      const arr = CHART_IDS.map((id) => ({ id, name: i18n.t(`reports:charts.${id}`), icon: CHART_ICONS[id] }));
      const val = (arr as unknown as Record<string | symbol, unknown>)[prop as string];
      return typeof val === "function" ? val.bind(arr) : val;
    },
  });
