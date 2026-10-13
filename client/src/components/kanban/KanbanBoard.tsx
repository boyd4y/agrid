import type { BoardViewConfig } from "@tabdo/shared";
import { useMemberOptions } from "@/hooks/useMemberOptions";
import { CellDisplay } from "@/components/table/CellEditors";
import { ColumnTypeIcon } from "@/components/table/ColumnTypeIcon";
import { openRelatedRecord } from "@/components/table/RelationPicker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, GripVertical, Loader2, MoreHorizontal, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DeleteConfirmation } from "@/components/ui/delete-confirmation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { FullTable, RowData, SelectOption, ColumnDef } from "@/types/table";
import { cn } from "@/lib/utils";
import { selectOptionSwatch } from "@/lib/select-colors";
import { useTranslation } from "react-i18next";

type Props = {
  table: FullTable;
  config?: BoardViewConfig | Record<string, unknown>;
  refreshToken?: number;
  onChange: (table: FullTable) => void;
};

function findStatusColumn(table: FullTable): ColumnDef | undefined {
  return (
    table.columns.find((c) => c.name === "状态" /* seed */ && c.type === "select") ||
    table.columns.find((c) => c.type === "select")
  );
}

function findTitleColumn(table: FullTable): ColumnDef | undefined {
  return (
    table.columns.find((c) => c.name === "标题" /* seed */) ||
    table.columns.find((c) => c.type === "text")
  );
}

/* built per-render via t("ungrouped") */
const PAGE = 40;
const INTERACTIVE_CARD_CHILD = "button,a,input,select,textarea,[contenteditable='true'],[role='button'],[role='link'],[role='checkbox'],[role='switch']";

function isInteractiveCardChild(target: EventTarget | null, card: HTMLElement) {
  const control = target instanceof Element ? target.closest(INTERACTIVE_CARD_CHILD) : null;
  return Boolean(control && control !== card);
}

type ColState = {
  rows: RowData[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
  loading: boolean;
};

export function KanbanBoard({ table, config: rawConfig, onChange, refreshToken }: Props) {
  const { t } = useTranslation("table");
  const UNGROUPED = { id: "__none__", label: t("ungrouped"), color: "#ebeced" } as const;
  const config = (rawConfig ?? {}) as BoardViewConfig;
  const members = useMemberOptions();
  const compact = config.density === "compact";
  const didDrag = useRef(false);
  const dragFromControl = useRef(false);
  const statusCol = useMemo(() => config.statusColumnId ? table.columns.find((column) => column.id === config.statusColumnId && column.type === "select") : findStatusColumn(table), [table, config.statusColumnId]);
  const titleCol = useMemo(() => findTitleColumn(table), [table]);
  const visible = (config.visibleColumnIds ?? table.columns.filter((column) => column.type === "person").map((column) => column.id)).flatMap((id) => {
    const column = table.columns.find((column) => column.id === id && column.id !== titleCol?.id && !column.config.hidden);
    return column ? [column] : [];
  });
  const [dragging, setDragging] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ row: RowData; group: string; title: string } | null>(null);
  const generation = useRef(0);
  const groupKey = useRef("");
  const currentKey = `${table.id}:${statusCol?.id ?? ""}:${refreshToken ?? 0}`;
  if (groupKey.current !== currentKey) { groupKey.current = currentKey; generation.current++; }
  const [cols, setCols] = useState<Record<string, ColState>>({});

  const columns: SelectOption[] = useMemo(() => {
    const opts = statusCol?.config?.options ?? [];
    return [...opts, UNGROUPED];
  }, [statusCol]);

  const loadColumn = useCallback(
    async (optionId: string, cursor: string | null = null, append = false) => {
      if (!statusCol) return;
      const current = generation.current;
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
        if (current !== generation.current) return;
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
        if (current !== generation.current) return;
        setError(e instanceof Error ? e.message : t("boardColLoadFailed"));
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
    setCols({}); setError(null);
    if (!statusCol) return;
    for (const col of columns) {
      void loadColumn(col.id, null, false);
    }
  }, [statusCol?.id, table.id, columns.map((c) => c.id).join(","), refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!statusCol) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-6 text-sm text-warning">
        {t("boardNeedsSelect")}
      </div>
    );
  }

  const moveCard = async (rowId: string, fromCol: string, toCol: string) => {
    if (fromCol === toCol) return;
    const current = generation.current;
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
      const saved = await api.patchRow(rowId, {
        cell: { columnId: statusCol.id, value: nextStatus },
        expectedVersion: row.version,
      });
      if (current !== generation.current) return;
      setCols((previous) => Object.fromEntries(Object.entries(previous).map(([id, state]) => [id, { ...state, rows: state.rows.map((candidate) => candidate.id === saved.id ? saved : candidate) }])));
    } catch (e) {
      if (current !== generation.current) return;
      setError(e instanceof Error ? e.message : t("moveFailed"));
      void loadColumn(fromCol);
      void loadColumn(toCol);
    }
  };

  const addInColumn = async (statusOptionId: string) => {
    const current = generation.current;
    const cells: Record<string, string | null> = {};
    if (titleCol) cells[titleCol.id] = t("newCard");
    cells[statusCol.id] = statusOptionId === UNGROUPED.id ? null : statusOptionId;
    try {
      const row = await api.addRow(table.id, cells);
      if (current !== generation.current) return;
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
      if (current !== generation.current) return;
      setError(e instanceof Error ? e.message : t("addFailed"));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {error && (
        <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
          <button type="button" className="ml-2 underline" onClick={() => setError(null)}>
            {t("close")}
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
              data-kanban-group={col.id}
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
                    ? String(row.cells[titleCol.id] ?? t("untitled"))
                    : row.id.slice(0, 8);

                  return (
                    <Card padding="none"
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      aria-label={t("openRecordNamed", { title })}
                      data-testid="board-card"
                      data-row-id={row.id}
                      data-density={compact ? "compact" : "comfortable"}
                      draggable
                      onPointerDown={(event) => { didDrag.current = false; dragFromControl.current = isInteractiveCardChild(event.target, event.currentTarget); }}
                      onClick={(event) => { if (!didDrag.current && !isInteractiveCardChild(event.target, event.currentTarget)) openRelatedRecord({ id: row.id, tableId: table.id, title }); }}
                      onKeyDown={(event) => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); openRelatedRecord({ id: row.id, tableId: table.id, title }); } }}
                      onDragStart={(e) => {
                        if (dragFromControl.current || isInteractiveCardChild(e.target, e.currentTarget)) { e.preventDefault(); return; }
                        didDrag.current = true;
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
                        "group/card cursor-pointer rounded-lg bg-background shadow-sm",
                        dragging === row.id && "opacity-50"
                      )}
                    >
                      <CardHeader className={cn("mb-0 flex-row items-start", compact ? "gap-1.5 p-2" : "gap-2 p-3")}>
                        <span data-board-drag-handle className="mt-0.5 shrink-0 cursor-grab active:cursor-grabbing" aria-label={t("dragCard")}><GripVertical className="size-3.5 text-muted-foreground/50" /></span>
                        <CardTitle className={cn("min-w-0 flex-1 line-clamp-2 font-medium", compact ? "text-xs leading-4" : "text-sm leading-5")}>{title}</CardTitle>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-6 shrink-0 opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100" aria-label={t("cardActionsNamed", { title })}><MoreHorizontal /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}><DropdownMenuGroup><DropdownMenuItem variant="destructive" onSelect={() => setDeleting({ row, group: col.id, title })}><Trash2 />{t("deleteCard")}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent>
                        </DropdownMenu>
                      </CardHeader>
                      {(() => {
                        const shown = visible.filter((column) => {
                          const value = row.cells[column.id];
                          const empty = value === null || value === undefined || value === "" || Array.isArray(value) && value.length === 0;
                          return !(config.hideEmpty ?? true) || !empty;
                        });
                        const content = shown.filter((column) => !["person", "date"].includes(column.type));
                        const footer = shown.filter((column) => ["person", "date"].includes(column.type));
                        const property = (column: ColumnDef, inFooter = false) => <div key={column.id} className={cn("flex min-w-0 items-center text-xs", compact ? "gap-1.5" : "gap-2", inFooter && "flex-1")} data-card-property={column.id}>
                          <ColumnTypeIcon type={column.type} className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className={cn("truncate text-muted-foreground", inFooter ? "sr-only" : "w-16 shrink-0")} title={column.name}>{column.name}</span>
                          <div className="min-w-0 flex-1"><CellDisplay column={column} value={row.cells[column.id] ?? null} members={members} relation={row.relations?.[column.id]} /></div>
                        </div>;
                        return <><CardContent className={cn("flex flex-col", compact ? "gap-1 px-2" : "gap-2 px-3", content.length > 0 && (compact ? "pb-2" : "pb-3"))} data-testid="board-card-content">{content.map((column) => property(column))}</CardContent>
                          {footer.length > 0 && <CardFooter className={cn("flex-wrap border-t border-border", compact ? "gap-1.5 px-2 py-1.5" : "gap-2 px-3 py-2")} data-testid="board-card-footer">{footer.map((column) => property(column, true))}</CardFooter>}
                        </>;
                      })()}
                    </Card>
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
                    {t("loadMore")}
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
                  {t("addCard")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="shrink-0 text-xs text-muted-foreground">
        {t("dragHint")}
      </p>
      <DeleteConfirmation open={Boolean(deleting)} onOpenChange={(open) => { if (!open) setDeleting(null); }} title={t("deleteCardQ")} description={t("deleteCardDesc", { title: deleting?.title ?? "" })} onConfirm={async () => {
        if (!deleting) return;
        const current = generation.current;
        try {
          await api.deleteRow(deleting.row.id);
          if (current !== generation.current) return;
          setCols((previous) => Object.fromEntries(Object.entries(previous).map(([id, state]) => [id, { ...state, rows: state.rows.filter((row) => row.id !== deleting.row.id), total: id === deleting.group ? Math.max(0, (state.total ?? state.rows.length) - 1) : state.total }])));
          onChange({ ...table, rowCount: Math.max(0, (table.rowCount ?? 1) - 1) });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t("deleteFailedRetry"));
          throw error;
        }
      }} />
    </div>
  );
}
