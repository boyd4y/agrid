import { z } from "zod";

/** Date-only records, independent of booking/time-zone semantics. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value < "0001-01-01" || value > "9998-12-31") return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}
export function shiftCalendarDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export const CALENDAR_DATE_SCHEMA = z.string().refine(isCalendarDate, "需要有效的 YYYY-MM-DD 日期");
export const CALENDAR_VIEW_CONFIG_SCHEMA = z.object({
  startColumnId: z.uuid(),
  endColumnId: z.uuid().nullable().optional(),
  titleColumnId: z.uuid().nullable().optional(),
  personColumnId: z.uuid().nullable().optional(),
  endMode: z.enum(["inclusive", "exclusive"]).default("inclusive"),
}).strict().refine(config => config.startColumnId !== config.endColumnId, "起始和结束日期需要不同字段");
export const CREATE_CALENDAR_VIEW_SCHEMA = z.object({ tableId: z.uuid(), name: z.string().trim().min(1).max(80).optional(), config: CALENDAR_VIEW_CONFIG_SCHEMA }).strict();
export const UPDATE_CALENDAR_VIEW_SCHEMA = z.object({ viewId: z.uuid(), config: CALENDAR_VIEW_CONFIG_SCHEMA }).strict();
export const QUERY_CALENDAR_VIEW_SCHEMA = z.object({
  viewId: z.uuid(), rangeStart: CALENDAR_DATE_SCHEMA, rangeEnd: CALENDAR_DATE_SCHEMA,
  limit: z.number().int().min(1).max(200).default(100), cursor: z.string().max(4000).nullable().optional(),
}).strict().refine(input => input.rangeStart < input.rangeEnd, "范围结束日期必须晚于起始日期");
export type CalendarViewConfig = z.infer<typeof CALENDAR_VIEW_CONFIG_SCHEMA>;
export type CreateCalendarViewInput = z.input<typeof CREATE_CALENDAR_VIEW_SCHEMA>;
export type UpdateCalendarViewInput = z.input<typeof UPDATE_CALENDAR_VIEW_SCHEMA>;
export type QueryCalendarViewInput = z.input<typeof QUERY_CALENDAR_VIEW_SCHEMA>;
export type CalendarMappingField = "startColumnId" | "endColumnId" | "titleColumnId" | "personColumnId";
export type CalendarMappingIssue = { field: CalendarMappingField; code: "missing" | "type" | "hidden" | "invalid_config" };
export type CalendarViewItem = {
  rowId: string; version: number; start: string;
  /** Always exclusive, including when the mapped end field includes its day. */
  end: string; title: string | null; person: string | string[] | null;
};
export type CalendarViewResult = {
  items: CalendarViewItem[]; nextCursor: string | null; hasMore: boolean; limit: number;
  diagnostics: { mapping: CalendarMappingIssue[]; emptyStart: number; invalidStart: number; invalidEnd: number; reversed: number };
};
