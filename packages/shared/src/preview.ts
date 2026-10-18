import { z } from "zod";

export const OPEN_PREVIEW_SCHEMA = z.strictObject({
  kind: z.enum(["table", "site", "report", "form", "automations"]).optional(),
  tableId: z.string().uuid().optional(),
  siteId: z.string().uuid().optional(),
  reportId: z.string().uuid().optional(),
  viewId: z.string().uuid().optional(),
  open: z.boolean().optional(),
}).superRefine((input, ctx) => {
  const kind = input.kind ?? "table";
  const invalid = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (kind === "site" && !input.siteId) invalid("siteId", "请指定siteId");
  if (kind === "report" && !input.reportId) invalid("reportId", "请指定reportId");
  if (input.siteId && kind !== "site") invalid("siteId", "siteId仅用于站点");
  if (input.reportId && kind !== "report") invalid("reportId", "reportId仅用于报告");
  if ((kind === "site" || kind === "report") && (input.tableId || input.viewId)) invalid("tableId", "资源类型与ID不匹配");
});

export type OpenPreviewInput = z.infer<typeof OPEN_PREVIEW_SCHEMA>;
