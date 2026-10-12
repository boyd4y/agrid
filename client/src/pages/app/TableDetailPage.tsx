import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Columns3,
  FileInput,
  LayoutGrid,
  Loader2,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DataTable } from "@/components/table/DataTable";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { FormDesigner } from "@/components/form/FormDesigner";
import { api } from "@/lib/api";
import type { FullTable } from "@/types/table";
import type { ResolvedFormView, TableView } from "@table/shared";
import { cn } from "@/lib/utils";
import type { AppOutletContext } from "@/layouts/AppShell";
import { useAppShell } from "@/context/AppShellContext";

function viewIcon(type: string) {
  if (type === "board") return LayoutGrid;
  if (type === "form") return FileInput;
  return Columns3;
}

function viewLabel(type: string, name: string) {
  return name || (type === "board" ? "看板" : type === "form" ? "表单" : "表格");
}

export function TableDetailPage() {
  const { tableId } = useParams<{ tableId: string }>();
  const { setTables, tableRefreshToken, notifyTableMutated } =
    useOutletContext<AppOutletContext>();
  const { setAiOpen, setActiveTableId } = useAppShell();
  const [table, setTable] = useState<FullTable | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [views, setViews] = useState<TableView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [formView, setFormView] = useState<ResolvedFormView | null>(null);
  const [viewsLoading, setViewsLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [menuViewId, setMenuViewId] = useState<string | null>(null);

  const activeView = useMemo(
    () => views.find((v) => v.id === activeViewId) ?? null,
    [views, activeViewId]
  );

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

  const loadViews = useCallback(async () => {
    if (!tableId) return;
    setViewsLoading(true);
    try {
      let list = await api.listViews(tableId);
      // Ensure at least one grid view exists (on-demand default)
      if (!list.some((v) => v.type === "grid")) {
        const grid = await api.createGridView(tableId, "表格");
        list = [...list, grid];
      }
      setViews(list);
      setActiveViewId((prev) => {
        if (prev && list.some((v) => v.id === prev)) return prev;
        const grid = list.find((v) => v.type === "grid");
        return grid?.id ?? list[0]?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载视图失败");
    } finally {
      setViewsLoading(false);
    }
  }, [tableId]);

  useEffect(() => {
    setLoading(true);
    setActiveTableId(tableId ?? null);
    void load();
    void loadViews();
  }, [tableId, load, loadViews, setActiveTableId]);

  useEffect(() => {
    if (tableRefreshToken > 0) void load();
  }, [tableRefreshToken, load]);

  useEffect(() => {
    if (!activeView || activeView.type !== "form") {
      setFormView(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const full = await api.getView(activeView.id);
        if (!cancelled) setFormView(full as ResolvedFormView);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "加载表单失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeView?.id, activeView?.type]);

  const renameTable = async (name: string) => {
    if (!table || !name.trim() || name === table.name) return;
    try {
      const updated = await api.patchTable(table.id, { name: name.trim() });
      setTable({ ...table, ...updated });
      setTables((prev) =>
        prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "重命名失败");
    }
  };

  const addView = async (type: "grid" | "board" | "form") => {
    if (!tableId) return;
    setAddOpen(false);
    try {
      let created: TableView;
      if (type === "grid") {
        created = await api.createGridView(tableId, `表格 ${views.filter((v) => v.type === "grid").length + 1}`);
      } else if (type === "board") {
        created = await api.createBoardView(tableId, { name: "看板" });
      } else {
        created = await api.createFormView(tableId, {
          name: "收集表",
          title: "收集表",
          description: "提交一条新记录",
          submitLabel: "提交",
          successMessage: "已写入表格",
        });
        // Apply Typeform defaults after create
        await api.setFormTheme(created.id, "sunset");
        created = await api.setFormLayout(created.id, "focus");
        setFormView(created as ResolvedFormView);
      }
      setViews((prev) => [...prev, created]);
      setActiveViewId(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建视图失败");
    }
  };


  const removeView = async (view: TableView) => {
    if (views.length <= 1) {
      setError("至少保留一个视图");
      return;
    }
    const label = viewLabel(view.type, view.name);
    if (!confirm(`确定删除视图「${label}」？`)) return;
    setMenuViewId(null);
    try {
      await api.deleteView(view.id);
      const remaining = views.filter((v) => v.id !== view.id);
      setViews(remaining);
      if (activeViewId === view.id) {
        const sameType = remaining.find((v) => v.type === view.type);
        setActiveViewId(sameType?.id ?? remaining[0]?.id ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除视图失败");
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        加载表格…
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

  const isForm = activeView?.type === "form";
  const isBoard = activeView?.type === "board";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border bg-background/80 py-3 pl-4 pr-2 backdrop-blur md:pl-6 md:pr-2">
        <div className="flex w-full flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            <nav
              aria-label="面包屑"
              className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"
              data-testid="table-breadcrumb"
            >
              <Link
                to="/app/tables"
                className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                表格
              </Link>
              <span className="text-[var(--notion-border)]">/</span>
              <span className="truncate text-foreground">{table.name}</span>
            </nav>
            <Input
              className="h-auto border-0 bg-transparent px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
              defaultValue={table.name}
              key={table.id + table.name}
              onBlur={(e) => renameTable(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
            {table.description && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {table.description}
              </p>
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <div
              className="flex max-w-[min(100vw-8rem,36rem)] items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-muted p-0.5"
              data-testid="view-switcher"
            >
              {views.map((v) => {
                const Icon = viewIcon(v.type);
                const active = v.id === activeViewId;
                const canDelete = views.length > 1;
                return (
                  <div
                    key={v.id}
                    className={cn(
                      "group flex shrink-0 items-center rounded-md",
                      active
                        ? "bg-background text-foreground shadow-[0_4px_12px_rgba(55,53,47,0.06)]"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <button
                      type="button"
                      data-testid={`view-${v.type}`}
                      data-view-id={v.id}
                      onClick={() => setActiveViewId(v.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setActiveViewId(v.id);
                        setMenuViewId(v.id);
                      }}
                      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium"
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {viewLabel(v.type, v.name)}
                    </button>
                    <Popover
                      open={menuViewId === v.id}
                      onOpenChange={(open) => setMenuViewId(open ? v.id : null)}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          data-testid={`view-menu-${v.id}`}
                          className={cn(
                            "mr-0.5 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground",
                            active || menuViewId === v.id
                              ? "opacity-100"
                              : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                          )}
                          title="视图选项"
                          aria-label="视图选项"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-36 p-1" align="start">
                        <button
                          type="button"
                          data-testid={`delete-view-${v.id}`}
                          disabled={!canDelete}
                          title={canDelete ? "删除视图" : "至少保留一个视图"}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                            canDelete
                              ? "text-red-600 hover:bg-red-50"
                              : "cursor-not-allowed text-muted-foreground opacity-60"
                          )}
                          onClick={() => void removeView(v)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          删除视图
                        </button>
                      </PopoverContent>
                    </Popover>
                  </div>
                );
              })}
              <Popover open={addOpen} onOpenChange={setAddOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    data-testid="add-view"
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                    title="添加视图"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-44 p-1" align="end">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                    onClick={() => void addView("grid")}
                  >
                    <Columns3 className="h-3.5 w-3.5" />
                    表格视图
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                    onClick={() => void addView("board")}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    看板视图
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                    onClick={() => void addView("form")}
                  >
                    <FileInput className="h-3.5 w-3.5" />
                    表单视图
                  </button>
                </PopoverContent>
              </Popover>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAiOpen(true)}
              title="打开 AI 助手 ⌘J"
            >
              <Sparkles className="h-3.5 w-3.5 text-[#9B6B9E]" />
              AI
            </Button>
          </div>
        </div>
        {error && (
          <div className="mx-auto mt-3 max-w-[1400px] rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4 md:px-8 md:py-5">
        {viewsLoading && !activeView ? (
          <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            加载视图…
          </div>
        ) : isForm ? (
          formView ? (
            <div className="mx-auto flex h-full min-h-0 w-full max-w-[1400px] flex-1 flex-col">
              <div className="flex min-h-0 flex-1 flex-col">
                <FormDesigner
                  table={table}
                  view={formView}
                  onChange={setFormView}
                  onSubmitted={() => {
                    notifyTableMutated();
                    void load();
                  }}
                />
              </div>
              <p className="mt-3 shrink-0 text-xs text-muted-foreground">
                视图按需添加 · 表单 / 看板 / 表格同一数据集
              </p>
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              加载表单…
            </div>
          )
        ) : isBoard ? (
          <div className="mx-auto flex h-full min-h-0 w-full max-w-[1400px] flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col">
              <KanbanBoard
                table={table}
                onChange={setTable}
                onRefresh={() => {
                  notifyTableMutated();
                  void load();
                }}
              />
            </div>
            <p className="mt-3 shrink-0 text-xs text-muted-foreground">
              视图按需添加 · 表单 / 看板 / 表格同一数据集
            </p>
          </div>
        ) : (
          <div className="mx-auto flex h-full min-h-0 w-full max-w-[1400px] flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col">
              <DataTable table={table} onChange={setTable} />
            </div>
            <p className="mt-3 shrink-0 text-xs text-muted-foreground">
              视图按需添加 · 表单 / 看板 / 表格同一数据集
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
