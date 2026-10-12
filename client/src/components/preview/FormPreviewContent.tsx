import { useEffect, useState } from "react";
import { Loader2, PanelRightClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableForm } from "@/components/form/TableForm";
import { api } from "@/lib/api";
import type { ResolvedFormView } from "@table/shared";
import type { PreviewSlotContext } from "./preview-slot";

/**
 * Form preview slot — same dataset as Grid; filled via TableForm → addRow.
 * Opened on demand via open_preview { kind: "form", tableId, viewId }.
 */
export function FormPreviewContent({
  tableId,
  table,
  viewId,
  onRefresh,
  onCollapse,
}: PreviewSlotContext) {
  const [view, setView] = useState<ResolvedFormView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!tableId) {
        setView(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        let targetId = viewId ?? null;
        if (!targetId) {
          const views = await api.listViews(tableId);
          const form = views.find((v) => v.type === "form");
          targetId = form?.id ?? null;
          if (!targetId) {
            const created = await api.createFormView(tableId, {
              name: "表单",
              title: table?.name ? `${table.name} · 表单` : "表单",
            });
            if (!cancelled) setView(created);
            return;
          }
        }
        const v = await api.getView(targetId);
        if (!cancelled) setView(v as ResolvedFormView);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "加载表单失败");
          setView(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [tableId, viewId, table?.name]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="preview-slot-form">
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {view?.config && "title" in view.config
              ? (view.config as { title?: string }).title || view.name
              : view?.name || "表单预览"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {table?.name ?? "同一数据集"}
          </p>
        </div>
        {onCollapse && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            data-testid="workspace-preview-collapse"
            aria-label="收起预览"
            onClick={onCollapse}
          >
            <PanelRightClose className="size-3.5" />
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
        {loading ? (
          <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载表单…
          </div>
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : !tableId || !table ? (
          <div className="text-sm text-muted-foreground">请先选择或创建表格</div>
        ) : (
          <TableForm
            table={table}
            view={view}
            onSubmitted={() => onRefresh()}
          />
        )}
      </div>
    </div>
  );
}
