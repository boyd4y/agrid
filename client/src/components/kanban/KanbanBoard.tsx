import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, GripVertical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { FullTable, RowData, SelectOption, ColumnDef } from "@/types/table";
import { cn } from "@/lib/utils";
import { selectOptionSwatch } from "@/lib/select-colors";

type Props = {
  table: FullTable;
  onChange: (table: FullTable) => void;
  onRefresh: () => void;
};

function findStatusColumn(table: FullTable): ColumnDef | undefined {
  return (
    table.columns.find((c) => c.name === "状态" && c.type === "select") ||
    table.columns.find((c) => c.type === "select")
  );
}

function findTitleColumn(table: FullTable): ColumnDef | undefined {
  return (
    table.columns.find((c) => c.name === "标题") ||
    table.columns.find((c) => c.type === "text")
  );
}

const UNGROUPED: SelectOption = { id: "__none__", label: "未分组", color: "#ebeced" };
const PAGE = 40;

type ColState = {
  rows: RowData[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
  loading: boolean;
};

export function KanbanBoard({ table, onChange, onRefresh }: Props) {
  const statusCol = useMemo(() => findStatusColumn(table), [table]);
  const titleCol = useMemo(() => findTitleColumn(table), [table]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cols, setCols] = useState<Record<string, ColState>>({});

  const columns: SelectOption[] = useMemo(() => {
    const opts = statusCol?.config?.options ?? [];
    return [...opts, UNGROUPED];
  }, [statusCol]);

  const loadColumn = useCallback(
    async (optionId: string, cursor: string | null = null, append = false) => {
      if (!statusCol) return;
      setCols((prev) => ({
        ...prev,
        [optionId]: {
          rows: append ? prev[optionId]?.rows ?? [] : [],
          nextCursor: prev[optionId]?.nextCursor ?? null,
          hasMore: prev[optionId]?.hasMore ?? false,
          total: prev[optionId]?.total,
          loading: true,
        },
      }));
      try {
        const page = await api.queryRowsPage(table.id, {
          statusColumnId: statusCol.id,
          statusValue: optionId === UNGROUPED.id ? null : optionId,
          cursor,
          limit: PAGE,
          includeTotal: !append,
        });
        setCols((prev) => {
          const prevRows = append ? prev[optionId]?.rows ?? [] : [];
          return {
            ...prev,
            [optionId]: {
              rows: [...prevRows, ...page.rows],
              nextCursor: page.nextCursor,
              hasMore: page.hasMore,
              total: append ? prev[optionId]?.total : page.totalMatched,
              loading: false,
            },
          };
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "看板列加载失败");
        setCols((prev) => ({
          ...prev,
          [optionId]: {
            ...(prev[optionId] ?? {
              rows: [],
              nextCursor: null,
              hasMore: false,
            }),
            loading: false,
          },
        }));
      }
    },
    [statusCol, table.id]
  );

  useEffect(() => {
    if (!statusCol) return;
    for (const col of columns) {
      void loadColumn(col.id, null, false);
    }
  }, [statusCol?.id, table.id, columns.map((c) => c.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!statusCol) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-6 text-sm text-warning">
        看板需要至少一列「单选」类型（建议命名为「状态」）才能分组。请先在表格视图添加列。
      </div>
    );
  }

  const moveCard = async (rowId: string, fromCol: string, toCol: string) => {
    if (fromCol === toCol) return;
    const nextStatus = toCol === UNGROUPED.id ? null : toCol;
    const fromState = cols[fromCol];
    const row = fromState?.rows.find((r) => r.id === rowId);
    if (!row) return;

    // optimistic move between column windows
    setCols((prev) => {
      const next = { ...prev };
      next[fromCol] = {
        ...prev[fromCol],
        rows: prev[fromCol].rows.filter((r) => r.id !== rowId),
        total: Math.max(0, (prev[fromCol].total ?? 1) - 1),
        loading: false,
      };
      const moved = {
        ...row,
        cells: { ...row.cells, [statusCol.id]: nextStatus },
      };
      next[toCol] = {
        ...prev[toCol],
        rows: [moved, ...(prev[toCol]?.rows ?? [])],
        total: (prev[toCol]?.total ?? 0) + 1,
        loading: false,
        nextCursor: prev[toCol]?.nextCursor ?? null,
        hasMore: prev[toCol]?.hasMore ?? false,
      };
      return next;
    });

    try {
      await api.patchRow(rowId, {
        cell: { columnId: statusCol.id, value: nextStatus },
        expectedVersion: row.version,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "移动失败");
      void loadColumn(fromCol);
      void loadColumn(toCol);
    }
  };

  const addInColumn = async (statusOptionId: string) => {
    const cells: Record<string, string | null> = {};
    if (titleCol) cells[titleCol.id] = "新卡片";
    cells[statusCol.id] = statusOptionId === UNGROUPED.id ? null : statusOptionId;
    try {
      const row = await api.addRow(table.id, cells);
      setCols((prev) => ({
        ...prev,
        [statusOptionId]: {
          ...prev[statusOptionId],
          rows: [row, ...(prev[statusOptionId]?.rows ?? [])],
          total: (prev[statusOptionId]?.total ?? 0) + 1,
          loading: false,
          nextCursor: prev[statusOptionId]?.nextCursor ?? null,
          hasMore: prev[statusOptionId]?.hasMore ?? false,
        },
      }));
      onChange({ ...table, rowCount: (table.rowCount ?? 0) + 1 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "新增失败");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {error && (
        <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
          <button type="button" className="ml-2 underline" onClick={() => setError(null)}>
            关闭
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto">
        {columns.map((col) => {
          const state = cols[col.id];
          const cards = state?.rows ?? [];
          return (
            <div
              key={col.id}
              className={cn(
                "flex h-full min-h-0 w-72 shrink-0 flex-col rounded-xl border bg-muted/80",
                overCol === col.id && dragging
                  ? "border-[var(--color-primary)] ring-2 ring-primary/30"
                  : "border-border"
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setOverCol(col.id);
              }}
              onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                const rowId = e.dataTransfer.getData("text/row-id");
                const fromCol = e.dataTransfer.getData("text/from-col");
                setOverCol(null);
                setDragging(null);
                if (rowId && fromCol) void moveCard(rowId, fromCol, col.id);
              }}
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: selectOptionSwatch(col.color) }}
                />
                <span className="text-sm font-semibold text-foreground">{col.label}</span>
                <span className="rounded-full bg-background px-1.5 text-xs text-muted-foreground ring-1 ring-border">
                  {state?.total ?? cards.length}
                  {state?.hasMore ? "+" : ""}
                </span>
                {state?.loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </div>
              <div className="flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto p-2">
                {cards.map((row) => {
                  const title = titleCol
                    ? String(row.cells[titleCol.id] ?? "无标题")
                    : row.id.slice(0, 8);
                  const personCol = table.columns.find((c) => c.type === "person");
                  const person = personCol ? String(row.cells[personCol.id] ?? "") : "";
                  return (
                    <div
                      key={row.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/row-id", row.id);
                        e.dataTransfer.setData("text/from-col", col.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(row.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOverCol(null);
                      }}
                      className={cn(
                        "cursor-grab rounded-lg border border-border bg-background p-3 shadow-sm active:cursor-grabbing",
                        dragging === row.id && "opacity-50"
                      )}
                    >
                      <div className="flex items-start gap-1.5">
                        <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-foreground">{title}</div>
                          {person && (
                            <div className="mt-1 text-xs text-muted-foreground">{person}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {state?.hasMore && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-muted-foreground"
                    disabled={state.loading}
                    onClick={() => void loadColumn(col.id, state.nextCursor, true)}
                  >
                    加载更多
                  </Button>
                )}
              </div>
              <div className="shrink-0 p-2 pt-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-muted-foreground"
                  onClick={() => void addInColumn(col.id)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  添加卡片
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="shrink-0 text-xs text-muted-foreground">
        拖拽卡片切换状态 · 每列窗口加载（{PAGE}/次）· 分组列：{statusCol.name}
        <button type="button" className="ml-2 underline" onClick={onRefresh}>
          刷新元数据
        </button>
      </p>
    </div>
  );
}
