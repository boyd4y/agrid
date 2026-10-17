export const REPORT_CHART_TYPES = ["bar", "bar-horizontal", "line", "area", "pie", "donut", "radar", "radial", "scatter", "funnel", "treemap"] as const;
export type ReportChartType = typeof REPORT_CHART_TYPES[number];
/** A grouped chart query. Kept separate from the report page and its layout. */
export type ReportConfig = {
  name: string;
  tableId: string;
  chartType: ReportChartType;
  groupColumnId: string;
  metric: "count" | "sum" | "average";
  valueColumnId: string | null;
  dateBucket: "day" | "month";
};
export type ReportMetricQuery = { tableId: string | null; metric: ReportConfig["metric"]; valueColumnId: string | null };
export type ReportChartQuery = ReportMetricQuery & { groupColumnId: string | null; chartType: ReportConfig["chartType"]; dateBucket: ReportConfig["dateBucket"] };
export type ReportWidgetLayout = { x: number; y: number; w: number; h: number };
type WidgetBase = { id: string; title: string; width: "full" | "half"; layout?: ReportWidgetLayout };
export type ReportWidget = WidgetBase & (
  | { type: "chart"; query: ReportChartQuery }
  | { type: "metric"; query: ReportMetricQuery }
  | { type: "text"; content: string }
);
export type ReportPageConfig = { name: string; description: string; columns: 1 | 2; widgets: ReportWidget[] };
export type Report = ReportPageConfig & { id: string; organizationId: string; workspaceId: string; version: number; createdAt: string | Date; updatedAt: string | Date };
export type ReportData = { points: { key: string; label: string; value: number | null; records: number }[]; totalRows: number; truncated: boolean; metricLabel: string; sourceName: string };
export type ReportMetricData = { value: number | null; totalRows: number; sourceName: string; metricLabel: string };
export type ReportWidgetResult = { id: string; data: ReportData | ReportMetricData | null; error: string | null };
export type ReportPageData = { widgets: ReportWidgetResult[] };

export function reportLayoutsOverlap(a: ReportWidgetLayout, b: ReportWidgetLayout) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
/** Resolve collisions by moving neighbours down; intentionally retain empty rows. */
export function settleReportLayout<T extends ReportWidgetLayout & { id: string }>(positions: T[], activeId?: string): T[] {
  const order = [...positions].sort((a, b) => a.id === activeId ? -1 : b.id === activeId ? 1 : a.y - b.y || a.x - b.x);
  const placed: T[] = [];
  for (const original of order) {
    const item = { ...original };
    while (placed.some((p) => reportLayoutsOverlap(p, item))) item.y = Math.max(...placed.filter((p) => reportLayoutsOverlap(p, item)).map((p) => p.y + p.h));
    placed.push(item);
  }
  return positions.map((p) => placed.find((item) => item.id === p.id)!);
}
/** Upgrade legacy flow layouts without moving explicitly positioned widgets. */
export function resolveReportLayout(page: ReportPageConfig): (ReportWidgetLayout & { id: string })[] {
  const placed = page.widgets.filter((w) => w.layout).map((w) => ({ id: w.id, ...w.layout! }));
  for (const widget of page.widgets) {
    if (widget.layout) continue;
    const w = widget.width === "full" || page.columns === 1 ? 12 : 6;
    const h = widget.type === "chart" ? 9 : 4;
    // Look only at row edges: the first available gap must start at an item edge.
    const candidates = [...new Set([0, ...placed.map((p) => p.y + p.h)])].sort((a, b) => a - b);
    let position: ReportWidgetLayout | undefined;
    for (const y of candidates) {
      for (let x = 0; x + w <= 12; x++) {
        const next = { x, y, w, h };
        if (!placed.some((p) => reportLayoutsOverlap(next, p))) { position = next;break; }
      }
      if (position) break;
    }
    placed.push({ id: widget.id, ...position! });
  }
  return page.widgets.map((widget) => placed.find((p) => p.id === widget.id)!);
}
export function withReportLayout(page: ReportPageConfig): ReportPageConfig {
  const positions = new Map(resolveReportLayout(page).map(({ id, ...position }) => [id, position]));
  return { ...page, widgets: page.widgets.map((widget) => ({ ...widget, layout: positions.get(widget.id)! })) };
}
