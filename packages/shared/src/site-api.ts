import type { CalendarPermission } from "./calendar.js";
import type { CellValue, ColumnType, SelectOption } from "./types.js";
import type { FilterCondition, FilterLogic } from "./filters.js";

export type TablePermission = { tableId: string; canRead: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean };
export type ApiKeyInput = { name: string; permissions: TablePermission[]; calendarPermissions?: CalendarPermission[]; schedulePermissions?: import("./calendar.js").SchedulePermission[] };
export type ApiKeyInfo = ApiKeyInput & { id: string; prefix: string; createdAt: string };
export type SiteKeyInput = ApiKeyInput;
export type SiteKeyInfo = ApiKeyInfo;
export type SiteColumn = { id: string; name: string; type: ColumnType; options: SelectOption[]; readable: boolean; writable: boolean };
export type SiteTable = { id: string; name: string; description: string | null; columns: SiteColumn[] };
export type SiteFile = { id: string; columnId: string; name: string; mimeType: string; size: number; url: string };
export type SiteRow = { id: string; tableId: string; version: number; cells: Record<string, CellValue>; files: SiteFile[]; createdAt: string; updatedAt: string };
export type SiteRowsOptions = { cursor?: string | null; limit?: number; filters?: Array<Omit<FilterCondition, "id"> & { id?: string }>; filterLogic?: FilterLogic; sort?: { columnId: string; direction: "asc" | "desc" } | null; includeTotal?: boolean };
export type SiteRowsPage = { rows: SiteRow[]; nextCursor: string | null; hasMore: boolean; totalMatched: number | null; limit: number };
export type SiteCreateReceipt = { id: string; createdAt: string };
