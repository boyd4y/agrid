import { z } from "zod";
import { REPORT_CHART_TYPES, reportLayoutsOverlap } from "@tabdo/shared";
const metric = z.enum(["count", "sum", "average"]);
export const reportLayoutSchema = z.strictObject({ x: z.number().int().min(0).max(11), y: z.number().int().min(0).max(10000), w: z.number().int().min(3).max(12), h: z.number().int().min(4).max(30) }).refine((p) => p.x + p.w <= 12, "组件不能超出 12 列画布");
export const reportConfigSchema = z.strictObject({ name: z.string().trim().min(1).max(120), tableId: z.uuid(), chartType: z.enum(REPORT_CHART_TYPES), groupColumnId: z.uuid(), metric, valueColumnId: z.uuid().nullable().default(null), dateBucket: z.enum(["day", "month"]).default("month") });
const base = { id: z.uuid().default(() => crypto.randomUUID()), title: z.string().trim().max(120), width: z.enum(["full", "half"]), layout: reportLayoutSchema.optional() };
const metricQuery = z.strictObject({ tableId: z.uuid().nullable(), metric, valueColumnId: z.uuid().nullable() });
export const reportWidgetSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("chart"), query: metricQuery.extend({ groupColumnId: z.uuid().nullable(), chartType: z.enum(REPORT_CHART_TYPES), dateBucket: z.enum(["day", "month"]) }) }),
  z.strictObject({ ...base, type: z.literal("metric"), query: metricQuery }),
  z.strictObject({ ...base, type: z.literal("text"), content: z.string().max(10_000) }),
]);
export const reportPageSchema = z.strictObject({ name: z.string().trim().min(1).max(120), description: z.string().max(2000).default(""), columns: z.union([z.literal(1), z.literal(2)]).default(2), widgets: z.array(reportWidgetSchema).max(40).default([]) }).superRefine((page, ctx) => {
  if (new Set(page.widgets.map((widget) => widget.id)).size !== page.widgets.length) ctx.addIssue({ code: "custom", path: ["widgets"], message: "报告组件 ID 不能重复" });
  for (let i = 0; i < page.widgets.length; i++) {
    const a = page.widgets[i].layout;
    if (a && page.widgets.slice(i + 1).some((widget) => widget.layout && reportLayoutsOverlap(a, widget.layout))) ctx.addIssue({ code: "custom", path: ["widgets", i, "layout"], message: "Dashboard 组件不能重叠，请调整位置" });
  }
});
