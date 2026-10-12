import { Loader2, PanelRightClose, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/table/DataTable";
import { NiTable } from "@/components/icons";
import { cn } from "@/lib/utils";
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
  tablesMeta,
  onSelectTable,
  onCreateTable,
  onCollapse,
}: PreviewSlotContext) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="preview-slot-table">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tablesMeta.length === 0 ? (
            <span className="text-xs text-muted-foreground">暂无表格</span>
          ) : (
            tablesMeta.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectTable(t.id)}
                className={cn(
                  "inline-flex max-w-[160px] shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors",
                  tableId === t.id
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
                title={t.name}
              >
                <NiTable className="h-3 w-3 shrink-0 opacity-60" />
                <span className="truncate">{t.name}</span>
              </button>
            ))
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {table && (
            <span className="hidden text-[11px] tabular-nums text-muted-foreground sm:inline">
              {table.rowCount.toLocaleString()} 行
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onCreateTable()}
          >
            <Plus className="h-3.5 w-3.5" />
            新建
          </Button>
          {onCollapse && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              data-testid="workspace-preview-collapse"
              aria-label="收起预览"
              title="收起预览"
              onClick={onCollapse}
            >
              <PanelRightClose className="size-3.5" />
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
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
            <p className="text-sm font-medium text-foreground">从对话建第一张表</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              左侧描述结构，或先建空表再在此编辑。
            </p>
            <Button size="sm" onClick={() => onCreateTable()}>
              <Plus className="h-3.5 w-3.5" />
              新建空表
            </Button>
          </div>
        ) : (
          <div className="h-full overflow-auto p-3 md:p-4">
            <DataTable table={table} onChange={setTable} />
          </div>
        )}
      </div>
    </div>
  );
}
