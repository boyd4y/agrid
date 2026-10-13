import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Funnel, FunnelChart, LabelList, Line, LineChart, Pie, PieChart, PolarAngleAxis, PolarGrid, Radar, RadarChart, RadialBar, RadialBarChart, Scatter, ScatterChart, Treemap, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@tabdo/ui/components/chart";
import type { ReportConfig, ReportData } from "@tabdo/shared";
import i18n from "@/i18n";
const color = (index: number) => `var(--chart-${index % 5 + 1})`;
const proportional = new Set(["pie", "donut", "radial", "funnel", "treemap"]);
export function ReportChart({ config, data }: { config: ReportConfig; data: ReportData }) {
  const empty = (text: string, error = false) => <div role={error ? "alert" : undefined} className={`flex h-full min-h-24 items-center justify-center text-center text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}>{text}</div>;
  if (!data.points.length) return empty(i18n.t("reports:emptyNoRows"));
  if (data.points.every((p) => p.value === null)) return empty(i18n.t("reports:emptyNoValues"));
  if (proportional.has(config.chartType) && data.points.some((p) => (p.value ?? 0) < 0)) return empty(i18n.t("reports:emptyNegativeAlt"), true);
  if (proportional.has(config.chartType) && data.points.every((p) => !p.value)) return empty(i18n.t("reports:emptyAllZero"));
  const limit = proportional.has(config.chartType) || config.chartType === "radar" ? 12 : 40;
  const points = data.points.slice(0, limit).map((p, i) => ({ ...p, fill: color(i) }));
  const tooltip = <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ""} />} />;
  const x = <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={20} />;
  const y = <YAxis tickLine={false} axisLine={false} width={48} />;
  const grid = <CartesianGrid vertical={false} />;
  let chart;
  switch (config.chartType) {
    case "pie": case "donut":
      chart = <PieChart accessibilityLayer>{tooltip}<Pie isAnimationActive={false} data={points} dataKey="value" nameKey="label" innerRadius={config.chartType === "donut" ? "50%" : 0} outerRadius="80%" paddingAngle={2}>{points.map((p) => <Cell key={p.key} fill={p.fill} />)}</Pie></PieChart>;break;
    case "line":
      chart = <LineChart accessibilityLayer data={points}>{grid}{x}{y}{tooltip}<Line isAnimationActive={false} dataKey="value" stroke="var(--color-value)" strokeWidth={2} dot={points.length === 1} /></LineChart>;break;
    case "area":
      chart = <AreaChart accessibilityLayer data={points}>{grid}{x}{y}{tooltip}<Area isAnimationActive={false} dataKey="value" type="monotone" stroke="var(--color-value)" fill="var(--color-value)" fillOpacity={0.2} dot={points.length === 1} /></AreaChart>;break;
    case "bar-horizontal":
      chart = <BarChart accessibilityLayer layout="vertical" data={points}><CartesianGrid horizontal={false} /><XAxis type="number" tickLine={false} axisLine={false} /><YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={80} />{tooltip}<Bar isAnimationActive={false} dataKey="value" fill="var(--color-value)" radius={4} /></BarChart>;break;
    case "radar":
      chart = <RadarChart accessibilityLayer data={points}>{tooltip}<PolarGrid /><PolarAngleAxis dataKey="label" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} /><Radar isAnimationActive={false} dataKey="value" stroke="var(--color-value)" fill="var(--color-value)" fillOpacity={0.25} /></RadarChart>;break;
    case "radial":
      chart = <RadialBarChart accessibilityLayer data={points} innerRadius="15%" outerRadius="85%" startAngle={90} endAngle={-270}><PolarAngleAxis type="number" domain={[0, Math.max(...points.map((p) => p.value ?? 0))]} tick={false} />{tooltip}<RadialBar isAnimationActive={false} dataKey="value" background cornerRadius={4} /></RadialBarChart>;break;
    case "scatter":
      chart = <ScatterChart accessibilityLayer>{grid}<XAxis dataKey="records" type="number" name={i18n.t("reports:recordCount")} tickLine={false} axisLine={false} allowDecimals={false} /><YAxis dataKey="value" type="number" name={data.metricLabel} tickLine={false} axisLine={false} width={48} />{tooltip}<Scatter isAnimationActive={false} data={points} fill="var(--color-value)" /></ScatterChart>;break;
    case "funnel":
      chart = <FunnelChart accessibilityLayer>{tooltip}<Funnel isAnimationActive={false} data={points} dataKey="value" nameKey="label"><LabelList dataKey="label" position="center" fill="var(--foreground)" /></Funnel></FunnelChart>;break;
    case "treemap":
      chart = <Treemap isAnimationActive={false} data={points.filter((p) => p.value !== null)} dataKey="value" nameKey="label" stroke="var(--background)" fill="var(--chart-1)">{tooltip}</Treemap>;break;
    default:
      chart = <BarChart accessibilityLayer data={points}>{grid}{x}{y}{tooltip}<Bar isAnimationActive={false} dataKey="value" fill="var(--color-value)" radius={4} /></BarChart>;
  }
  return <div className="flex h-full min-h-0 flex-col gap-2"><ChartContainer config={{ value: { label: data.metricLabel, color: "var(--chart-1)" }, records: { label: i18n.t("reports:recordCount"), color: "var(--chart-2)" } }} className="min-h-24 w-full flex-1 aspect-auto">{chart}</ChartContainer>
    {config.chartType === "scatter" && <p className="text-xs text-muted-foreground">{i18n.t("reports:scatterHint", { metric: data.metricLabel })}</p>}
    {proportional.has(config.chartType) && config.chartType !== "funnel" && <div className="flex max-h-12 flex-wrap justify-center gap-x-3 gap-y-1 overflow-auto text-xs text-muted-foreground">{points.map((p) => <span key={p.key} className="inline-flex items-center gap-1"><span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: p.fill }} />{p.label}</span>)}</div>}
    {data.points.length > points.length && <p className="text-xs text-muted-foreground">{i18n.t("reports:showingFirstGroups", { n: points.length })}</p>}
  </div>;
}
