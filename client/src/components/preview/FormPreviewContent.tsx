import { useEffect, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableForm } from "@/components/form/TableForm";
import { api } from "@/lib/api";
import type { ResolvedFormView } from "@tabdo/shared";
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
  refreshToken,
}: PreviewSlotContext) {
  const [view, setView] = useState<ResolvedFormView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentTableId = useRef(tableId);
  currentTableId.current = tableId;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!tableId) {
        setView(null);
        setLoading(false);
        setError(null);
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
          if (!targetId) { if (!cancelled) setView(null); return; }
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
  }, [tableId, viewId, table?.name, refreshToken]);

  const createForm = async () => {
    if (!tableId) return;
    const id = tableId;
    setLoading(true);
    setError(null);
    try {
      const created = await api.createFormView(id, {
        name: "表单",
        title: table?.name ? `${table.name} · 表单` : "表单",
      });
      if (currentTableId.current === id) setView(created);
    } catch (error) {
      if (currentTableId.current === id) setError(error instanceof Error ? error.message : "创建表单失败");
    } finally {
      if (currentTableId.current === id) setLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="preview-slot-form">

      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
        {loading && !view ? (
          <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载表单…
          </div>
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : !tableId || !table ? (
          <div className="text-sm text-muted-foreground">请先选择或创建表格</div>
        ) : !view ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">这张表格还没有表单</p>
            <Button size="sm" onClick={() => void createForm()}><Plus className="size-3.5" />创建表单</Button>
          </div>
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
