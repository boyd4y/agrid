import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/table/DataTable";
import type { PreviewSlotContext } from "./preview-slot";

/**
 * Default preview slot body — same DataTable component + same API data
 * as TableDetailPage (/app/tables/:id). Not a mock / separate grid.
 */
export function TablePreviewContent({
  tableId,
  table,
  setTable,
  loading,
  error,
  onCreateTable,
  refreshToken,
}: PreviewSlotContext) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="preview-slot-table">

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading && !table ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center p-8 text-sm text-destructive">
            {error}
          </div>
        ) : !tableId || !table ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm font-medium text-foreground">选择表格开始工作</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              从上方选择已有表格，或创建一张新表格。
            </p>
            <Button size="sm" onClick={() => onCreateTable()}>
              <Plus className="h-3.5 w-3.5" />
              新建空表
            </Button>
          </div>
        ) : (
          <div className="h-full overflow-auto p-3 md:p-4">
            <DataTable table={table} onChange={setTable} refreshToken={refreshToken} />
          </div>
        )}
      </div>
    </div>
  );
}
