import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { AutomationPanel } from "@/components/automation/AutomationPanel";
import { api } from "@/lib/api";
import type { FullTable } from "@/types/table";
import { useAppShell } from "@/context/AppShellContext";
import { APP_NAVIGATION } from "@/components/shell/app-navigation";

const AutomationIcon = APP_NAVIGATION.automations.icon;

export function TableAutomationsPage() {
  const { tableId } = useParams<{ tableId: string }>();
  const { setActiveTableId } = useAppShell();
  const [table, setTable] = useState<FullTable | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tableId) return;
    try {
      const full = await api.getTable(tableId);
      setTable({ ...full, rows: full.rows ?? [], rowCount: full.rowCount ?? 0 });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [tableId]);

  useEffect(() => {
    setLoading(true);
    setActiveTableId(tableId ?? null);
    void load();
  }, [tableId, load, setActiveTableId]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        加载自动化…
      </div>
    );
  }

  if (!table) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        {error || "表格不存在"}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="automations-page">
      <div className="shrink-0 border-b border-border bg-background/80 px-4 py-3 backdrop-blur md:px-6">
        <nav
          aria-label="面包屑"
          className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Link
            to="/app/tables"
            className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 font-medium transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            表格
          </Link>
          <span className="text-border">/</span>
          <Link
            to={`/app/tables/${table.id}`}
            className="truncate rounded-md px-1 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
          >
            {table.name}
          </Link>
          <span className="text-border">/</span>
          <span className="text-foreground">自动化</span>
        </nav>
        <div className="flex items-center gap-2">
          <AutomationIcon className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">自动化</h1>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {table.name} · 表格设置
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4 md:px-8 md:py-6">
        <div className="min-w-0 w-full">
          {error && (
            <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <AutomationPanel table={table} />
        </div>
      </div>
    </div>
  );
}
