import { z } from "zod";

export const chatContextSchema = z.object({
  page: z.enum(["ai", "tables", "table", "automations", "reports", "skills", "agents", "members", "settings", "schedules", "sites"]).default("ai"),
  tableId: z.uuid().nullable().optional(),
  siteId: z.uuid().nullable().optional(),
  reportId: z.uuid().nullable().optional(),
  scheduledTaskId: z.uuid().nullable().optional(),
});
export type ChatContext = z.infer<typeof chatContextSchema>;

export function contextResourceKey(context: ChatContext) {
  if (context.scheduledTaskId) return `schedule:${context.scheduledTaskId}`;
  if (context.siteId) return `site:${context.siteId}`;
  if (context.reportId) return `report:${context.reportId}`;
  if (context.tableId) return `table:${context.tableId}`;
  return context.page === "ai" ? "workspace" : context.page;
}

