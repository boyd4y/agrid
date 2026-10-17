import { eq } from "drizzle-orm";
import { tableViews } from "../db/schema.js";
import type { CommandDependencies } from "../dependencies.js";
import { queryCalendarView } from "../commands/calendar-views.js";
import { tableColumns, type SiteContext } from "./data.js";
import { ServiceError } from "../errors.js";
import { QUERY_CALENDAR_VIEW_SCHEMA } from "@tabdo/shared";

/** A table read grant permits projection only; it never grants view management. */
export async function siteQueryCalendarView(deps: CommandDependencies, context: SiteContext, input: unknown) {
  const parsed = QUERY_CALENDAR_VIEW_SCHEMA.parse(input);
  const [view] = await deps.database.select().from(tableViews).where(eq(tableViews.id, parsed.viewId));
  if (!view) throw new ServiceError(404, { message: "View not found" });
  const { table } = await tableColumns(deps.database, context.principal, view.tableId, "read");
  return queryCalendarView({ ...deps, workspaceId: table.workspaceId }, { ...parsed, organizationId: context.principal.organizationId });
}
