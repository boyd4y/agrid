import { useCallback, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Plus,
  Trash2,
  Type,
  Hash,
  List,
  Tags,
  Calendar,
  CheckSquare,
  User,
  FunctionSquare,
  MoreHorizontal,
  ArrowUpDown,
  EyeOff,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CellDisplay, CellEditor } from "./CellEditors";
import { FilterBar } from "./FilterBar";
import { ColumnSettings } from "./ColumnSettings";
import { cn } from "@/lib/utils";
import { api, type MemberOption } from "@/lib/api";
import type {
  CellValue,
  ColumnDef,
  ColumnType,
  FullTable,
  RowData,
} from "@/types/table";
import { COLUMN_TYPE_LABELS } from "@/types/table";
import { validateCell, type FilterCondition, type FilterLogic } from "@table/shared";
import { useWindowedRows } from "@/hooks/useWindowedRows";

const TYPE_ICONS: Record<ColumnType, ReactNode> = {
  text: <Type className="h-3.5 w-3.5" />,
  number: <Hash className="h-3.5 w-3.5" />,
  select: <List className="h-3.5 w-3.5" />,
  multi_select: <Tags className="h-3.5 w-3.5" />,
  date: <Calendar className="h-3.5 w-3.5" />,
  checkbox: <CheckSquare className="h-3.5 w-3.5" />,
  person: <User className="h-3.5 w-3.5" />,
  formula: <FunctionSquare className="h-3.5 w-3.5" />,
};

const DEFAULT_SELECT_OPTIONS = [
  { id: "a", label: "选项 A", color: "#d3e5ef" },
  { id: "b", label: "选项 B", color: "#dbeddb" },
  { id: "c", label: "选项 C", color: "#fadec9" },
];

const ROW_H = 36;

type Props = {
  table: FullTable;
  onChange: (table: FullTable) => void;
};

export function DataTable({ table, onChange }: Props) {
  const [editing, setEditing] = useState<{ rowId: string; colId: string } | null>(null);
  const [addingCol, setAddingCol] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [newColType, setNewColType] = useState<ColumnType>("text");
  const [newColFormula, setNewColFormula] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [settingsCol, setSettingsCol] = useState<ColumnDef | null>(null);
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [filterLogic, setFilterLogic] = useState<FilterLogic>("and");
  const [sort, setSort] = useState<{ columnId: string; direction: "asc" | "desc" } | null>(
    null
  );
  const [members, setMembers] = useState<MemberOption[]>([]);
  const resizing = useRef<{ colId: string; startX: number; startW: number } | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const windowed = useWindowedRows({
    tableId: table.id,
    filters,
    filterLogic,
    sort,
  });

  useEffect(() => {
    api.listMembers().then((r) => setMembers(r.members ?? [])).catch(() => {});
  }, []);

  const updateLocal = useCallback(
    (next: FullTable) => onChange(next),
    [onChange]
  );

  const sortedCols = useMemo(
    () => [...table.columns].sort((a, b) => a.sortOrder - b.sortOrder),
    [table.columns]
  );

  const visibleCols = useMemo(
    () => sortedCols.filter((c) => !c.config?.hidden),
    [sortedCols]
  );

  const hiddenCols = useMemo(
    () => sortedCols.filter((c) => c.config?.hidden),
    [sortedCols]
  );

  const totalWidth = useMemo(() => {
    return 48 + visibleCols.reduce((s, c) => s + c.width, 0) + 44;
  }, [visibleCols]);

  const rowVirtualizer = useVirtualizer({
    count: windowed.totalMatched,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 24,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    if (!virtualItems.length) return;
    const start = virtualItems[0].index;
    const end = virtualItems[virtualItems.length - 1].index;
    void windowed.ensureRange(start, end);
  }, [virtualItems, windowed]);

  const commitCell = async (row: RowData, columnId: string, value: CellValue) => {
    setEditing(null);
    const col = table.columns.find((c) => c.id === columnId);
    if (col) {
      const err = validateCell(col.type, value, col.config?.options);
      if (err) {
        setError(`${col.name}: ${err}`);
        return;
      }
    }
    const optimistic = {
      ...row,
      cells: { ...row.cells, [columnId]: value },
    };
    windowed.upsertRow(optimistic);
    try {
      const updated = await api.patchRow(row.id, {
        cell: { columnId, value },
        expectedVersion: row.version,
      });
      windowed.upsertRow(updated);
    } catch (e) {
      windowed.upsertRow(row);
      setError(e instanceof Error ? e.message : "保存失败");
    }
  };

  const addRow = async () => {
    try {
      const row = await api.addRow(table.id);
      windowed.prependOrAppendRow(row, true);
      onChange({ ...table, rowCount: (table.rowCount ?? 0) + 1 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "新增行失败");
    }
  };

  const deleteRow = async (row: RowData) => {
    windowed.removeRow(row.id);
    try {
      await api.deleteRow(row.id);
      onChange({ ...table, rowCount: Math.max(0, (table.rowCount ?? 1) - 1) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除行失败");
      void windowed.reload();
    }
  };

  const addColumn = async () => {
    if (!newColName.trim()) return;
    if (newColType === "formula" && !newColFormula.trim()) {
      setError("公式列需要填写表达式");
      return;
    }
    const config =
      newColType === "select" || newColType === "multi_select"
        ? { options: DEFAULT_SELECT_OPTIONS }
        : newColType === "formula"
          ? { formula: newColFormula.trim(), formulaResultType: "auto" as const }
          : {};
    setAddingCol(false);
    try {
      const col = await api.addColumn(table.id, {
        name: newColName.trim(),
        type: newColType,
        config,
      });
      updateLocal({ ...table, columns: [...table.columns, col] });
      // reload rows so computed formula values appear
      void windowed.reload();
      setNewColName("");
      setNewColType("text");
      setNewColFormula("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "新增列失败");
    }
  };

  const patchColumn = async (
    columnId: string,
    data: Parameters<typeof api.patchColumn>[1]
  ) => {
    try {
      const updated = await api.patchColumn(columnId, data);
      updateLocal({
        ...table,
        columns: table.columns.map((c) => (c.id === columnId ? updated : c)),
      });
      if (
        data.type === "formula" ||
        data.config?.formula !== undefined ||
        data.config?.formulaResultType !== undefined
      ) {
        void windowed.reload();
      }
      return updated;
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新列失败");
      throw e;
    }
  };

  const deleteColumn = async (columnId: string) => {
    setSettingsCol(null);
    const prev = table;
    updateLocal({
      ...table,
      columns: table.columns.filter((c) => c.id !== columnId),
    });
    try {
      await api.deleteColumn(columnId);
    } catch (e) {
      updateLocal(prev);
      setError(e instanceof Error ? e.message : "删除列失败");
    }
  };

  const moveColumn = async (columnId: string, dir: "left" | "right") => {
    const ids = sortedCols.map((c) => c.id);
    const i = ids.indexOf(columnId);
    if (i < 0) return;
    const j = dir === "left" ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    try {
      const cols = await api.reorderColumns(table.id, next);
      updateLocal({ ...table, columns: cols });
    } catch (e) {
      setError(e instanceof Error ? e.message : "重排列失败");
    }
  };

  const toggleSort = (columnId: string) => {
    setSort((s) => {
      if (!s || s.columnId !== columnId) return { columnId, direction: "asc" };
      if (s.direction === "asc") return { columnId, direction: "desc" };
      return null;
    });
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const { colId, startX, startW } = resizing.current;
      const w = Math.max(80, startW + (e.clientX - startX));
      updateLocal({
        ...table,
        columns: table.columns.map((c) => (c.id === colId ? { ...c, width: w } : c)),
      });
    };
    const onUp = async () => {
      if (!resizing.current) return;
      const { colId } = resizing.current;
      const col = table.columns.find((c) => c.id === colId);
      resizing.current = null;
      if (col) {
        try {
          await api.patchColumn(colId, { width: col.width });
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [table, updateLocal]);

  const displayError = error || windowed.error;

  return (
    <div className="flex flex-col gap-3">
      {displayError && (
        <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{displayError}</span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              windowed.setError(null);
            }}
            className="underline"
          >
            关闭
          </button>
        </div>
      )}

      <FilterBar
        columns={sortedCols}
        filters={filters}
        filterLogic={filterLogic}
        onChange={(f, logic) => {
          setFilters(f);
          setFilterLogic(logic);
        }}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <ArrowUpDown className="h-3.5 w-3.5" />
        {windowed.loading ? (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> 加载中…
          </span>
        ) : (
          <span>
            匹配 {windowed.totalMatched.toLocaleString()} 行 · 表内共{" "}
            {(table.rowCount ?? 0).toLocaleString()} 行 · 虚拟滚动
          </span>
        )}
        {sort && (
          <button type="button" className="underline" onClick={() => setSort(null)}>
            清除排序
          </button>
        )}
        {hiddenCols.length > 0 && (
          <div className="flex items-center gap-1">
            <EyeOff className="h-3.5 w-3.5" />
            已隐藏:
            {hiddenCols.map((c) => (
              <button
                key={c.id}
                type="button"
                className="rounded bg-muted px-1.5 py-0.5 hover:bg-accent"
                onClick={() =>
                  void patchColumn(c.id, {
                    config: { ...c.config, hidden: false },
                  })
                }
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
        {/* sticky header */}
        <div className="overflow-x-auto border-b border-border bg-muted/90">
          <div className="flex h-9 min-w-max text-sm font-medium text-muted-foreground" style={{ width: totalWidth }}>
            <div className="flex w-12 shrink-0 items-center justify-center text-muted-foreground">#</div>
            {visibleCols.map((col) => (
              <div
                key={col.id}
                data-col-header={col.name}
                data-col-type={col.type}
                className="relative flex h-9 shrink-0 items-center gap-1 px-1"
                style={{ width: col.width, minWidth: col.width }}
              >
                <span className="text-muted-foreground">{TYPE_ICONS[col.type as ColumnType]}</span>
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-sm font-medium"
                  onClick={() => toggleSort(col.id)}
                  title="点击排序"
                >
                  {col.name}
                  {sort?.columnId === col.id && (
                    <span className="ml-1 text-[10px] text-blue-600">
                      {sort.direction === "asc" ? "↑" : "↓"}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent"
                  onClick={() => setSettingsCol(col)}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
                <div
                  className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/40"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    resizing.current = {
                      colId: col.id,
                      startX: e.clientX,
                      startW: col.width,
                    };
                  }}
                />
              </div>
            ))}
            <button
              type="button"
              className="flex w-11 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
              title="添加列"
              onClick={() => setAddingCol(true)}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* virtual body */}
        <div
          ref={parentRef}
          className="overflow-auto"
          style={{ height: "min(60vh, 560px)" }}
        >
          <div
            className="relative"
            style={{ height: rowVirtualizer.getTotalSize(), width: totalWidth }}
          >
            {virtualItems.map((vi) => {
              const row = windowed.getRow(vi.index);
              return (
                <div
                  key={vi.key}
                  className="absolute left-0 flex border-b border-border hover:bg-muted/60"
                  style={{
                    height: vi.size,
                    transform: `translateY(${vi.start}px)`,
                    width: totalWidth,
                  }}
                >
                  <div className="group flex w-12 shrink-0 items-center justify-center gap-1 text-xs text-muted-foreground">
                    {row ? (
                      <>
                        <span className="group-hover:hidden">{vi.index + 1}</span>
                        <button
                          type="button"
                          className="hidden rounded p-0.5 text-muted-foreground hover:bg-red-50 hover:text-red-500 group-hover:inline-flex"
                          title="删除行"
                          onClick={() => void deleteRow(row)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" />
                    )}
                  </div>
                  {visibleCols.map((col) => {
                    if (!row) {
                      return (
                        <div
                          key={col.id}
                          className="h-9 shrink-0 bg-muted/40"
                          style={{ width: col.width, minWidth: col.width }}
                        />
                      );
                    }
                    const isEditing =
                      editing?.rowId === row.id && editing?.colId === col.id;
                    const value = row.cells[col.id] ?? null;
                    return (
                      <div
                        key={col.id}
                        data-cell
                        data-col-name={col.name}
                        data-col-type={col.type}
                        data-row-id={row.id}
                        className={cn(
                          "relative flex h-9 shrink-0 items-center px-2",
                          col.type === "formula" ? "cursor-default bg-muted/40" : "cursor-pointer",
                          isEditing && "cell-editing"
                        )}
                        style={{ width: col.width, minWidth: col.width }}
                        onClick={() => {
                          if (col.type === "formula") return;
                          if (!isEditing) setEditing({ rowId: row.id, colId: col.id });
                        }}
                        title={
                          col.type === "formula"
                            ? `公式: ${col.config?.formula ?? ""}`
                            : undefined
                        }
                      >
                        {isEditing ? (
                          <CellEditor
                            column={col}
                            value={value}
                            members={members}
                            onCommit={(v) => void commitCell(row, col.id, v)}
                            onCancel={() => setEditing(null)}
                          />
                        ) : (
                          <CellDisplay column={col} value={value} members={members} />
                        )}
                      </div>
                    );
                  })}
                  <div className="w-11 shrink-0" />
                </div>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void addRow()}
          className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
        >
          <Plus className="h-4 w-4" />
          新行
        </button>
      </div>

      {addingCol && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-background p-4 shadow-xl">
            <h3 className="mb-3 text-base font-semibold">添加列</h3>
            <Label className="mb-1 block">列名</Label>
            <Input
              className="mb-3"
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              placeholder="例如：备注"
              autoFocus
            />
            <Label className="mb-1 block">类型</Label>
            <Select
              value={newColType}
              onValueChange={(v) => setNewColType(v as ColumnType)}
            >
              <SelectTrigger className="mb-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(COLUMN_TYPE_LABELS) as ColumnType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {COLUMN_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {newColType === "formula" && (
              <div className="mb-4">
                <Label className="mb-1 block">公式</Label>
                <Textarea
                  className="min-h-[72px] font-mono text-sm"
                  value={newColFormula}
                  onChange={(e) => setNewColFormula(e.target.value)}
                  placeholder={'{预估工时} * 8'}
                  spellCheck={false}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  用 {"{列名}"} 引用；支持 IF / AND / OR、四则运算等
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAddingCol(false)}>
                取消
              </Button>
              <Button onClick={() => void addColumn()}>添加</Button>
            </div>
          </div>
        </div>
      )}

      {settingsCol && (
        <ColumnSettings
          column={settingsCol}
          allColumns={table.columns}
          onClose={() => setSettingsCol(null)}
          onSave={async (patch) => {
            await patchColumn(settingsCol.id, patch);
          }}
          onDelete={() => void deleteColumn(settingsCol.id)}
          onHide={() => {
            void patchColumn(settingsCol.id, {
              config: { ...settingsCol.config, hidden: true },
            });
            setSettingsCol(null);
          }}
          onMove={(dir) => void moveColumn(settingsCol.id, dir)}
        />
      )}
    </div>
  );
}
