import { useMemberOptions } from "@/hooks/useMemberOptions";
import { ColumnTypeIcon } from "./ColumnTypeIcon";
import { RelationColumnConfig } from "./RelationColumnConfig";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Plus,
  Trash2,
  MoreHorizontal,
  ArrowUpDown,
  EyeOff,
  Loader2,
  ChevronDown,
  Pencil,
  X,
} from "lucide-react";
import { Button } from "@tabdo/ui/components/button";
import { DeleteConfirmation } from "@/components/controls/delete-confirmation";
import { Input } from "@tabdo/ui/components/input";
import { Textarea } from "@tabdo/ui/components/textarea";
import { Switch } from "@tabdo/ui/components/switch";
import { Label } from "@tabdo/ui/components/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tabdo/ui/components/select";
import { CellDisplay, CellEditor } from "./CellEditors";
import { FilterBar } from "./FilterBar";
import { ColumnSettings } from "./ColumnSettings";
import { Popover, PopoverContent, PopoverTrigger } from "@tabdo/ui/components/popover";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type {
  CellValue,
  ColumnDef,
  ColumnType,
  FullTable,
  RowData,
} from "@/types/table";
import { COLUMN_TYPE_LABELS } from "@/types/table";
import {
  validateCell,
  isFilterConditionComplete,
  type FilterCondition,
  type FilterLogic,
} from "@tabdo/shared";
import { useWindowedRows } from "@/hooks/useWindowedRows";
import { useTranslation } from "react-i18next";

function defaultSelectOptions(t: (k: string) => string) {
  return [
    { id: "a", label: t("defaultOptionA"), color: "#d3e5ef" },
    { id: "b", label: t("defaultOptionB"), color: "#dbeddb" },
    { id: "c", label: t("defaultOptionC"), color: "#fadec9" },
  ];
}

const ROW_H = 36;
const HEADER_H = ROW_H + 1; // Header row and its bottom border.

type Props = {
  table: FullTable;
  refreshToken?: number;
  onChange: (table: FullTable) => void;
};

export function DataTable({ table, onChange, refreshToken }: Props) {
  const { t } = useTranslation("table");
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: "row"; row: RowData } | { kind: "column"; column: ColumnDef } | null
  >(null);
  const [editing, setEditing] = useState<{
    rowId: string;
    colId: string;
  } | null>(null);
  const [addingCol, setAddingCol] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [newColType, setNewColType] = useState<ColumnType>("text");
  const [newColConfig, setNewColConfig] = useState<ColumnDef["config"]>({});
  const [addingBusy, setAddingBusy] = useState(false);
  const [newColFormula, setNewColFormula] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [settingsCol, setSettingsCol] = useState<ColumnDef | null>(null);
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [filterLogic, setFilterLogic] = useState<FilterLogic>("and");
  const [sort, setSort] = useState<{
    columnId: string;
    direction: "asc" | "desc";
  } | null>(null);
  const members = useMemberOptions();
  const resizing = useRef<{
    colId: string;
    startX: number;
    startW: number;
  } | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const windowed = useWindowedRows({
    tableId: table.id,
    filters,
    filterLogic,
    sort,
    refreshToken,
  });



  // Keep the unfiltered sample stable while filtering, including queries with no matches.
  const filterSamples = useRef<{ tableId: string; rows: RowData[] }>({ tableId: table.id, rows: [] });
  if (filterSamples.current.tableId !== table.id) filterSamples.current = { tableId: table.id, rows: [] };
  if (!windowed.loading && !filters.some(isFilterConditionComplete)) {
    const samples = windowed.rowsSnapshot();
    if (samples.length) filterSamples.current.rows = samples;
  }

  const updateLocal = useCallback(
    (next: FullTable) => onChange(next),
    [onChange],
  );

  const sortedCols = useMemo(
    () => [...table.columns].sort((a, b) => a.sortOrder - b.sortOrder),
    [table.columns],
  );

  const visibleCols = useMemo(
    () => sortedCols.filter((c) => !c.config?.hidden),
    [sortedCols],
  );

  const hiddenCols = useMemo(
    () => sortedCols.filter((c) => c.config?.hidden),
    [sortedCols],
  );

  const totalWidth = useMemo(() => {
    return 48 + visibleCols.reduce((s, c) => s + c.width, 0) + 44;
  }, [visibleCols]);

  const rowVirtualizer = useVirtualizer({
    count: windowed.totalMatched,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    scrollMargin: HEADER_H,
    scrollPaddingStart: HEADER_H,
    overscan: 24,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    if (!virtualItems.length) return;
    const start = virtualItems[0].index;
    const end = virtualItems[virtualItems.length - 1].index;
    void windowed.ensureRange(start, end);
  }, [virtualItems, windowed]);

  const commitCell = async (
    row: RowData,
    columnId: string,
    value: CellValue,
  ) => {
    const col = table.columns.find((c) => c.id === columnId);
    if (col?.type === "file") {
      // Uploads stay in the editor until the row PATCH succeeds, and retry reuses the uploaded IDs.
      const updated = await api.patchRow(row.id, { cell: { columnId, value }, expectedVersion: row.version });
      windowed.upsertRow(updated);
      return;
    }
    setEditing(null);
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
      setError(e instanceof Error ? e.message : t("saveFailed"));
    }
  };

  const addRow = async () => {
    try {
      const row = await api.addRow(table.id);
      windowed.prependOrAppendRow(row, true);
      onChange({ ...table, rowCount: (table.rowCount ?? 0) + 1 });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("addRowFailed"));
    }
  };

  const deleteRow = async (row: RowData) => {
    await api.deleteRow(row.id);
    windowed.removeRow(row.id);
    onChange({ ...table, rowCount: Math.max(0, (table.rowCount ?? 1) - 1) });
  };

  const addColumn = async () => {
    if (!newColName.trim()) return;
    if (newColType === "formula" && !newColFormula.trim()) {
      setError(t("formulaNeedsExpression"));
      return;
    }
    const config =
      newColType === "select" || newColType === "multi_select"
        ? { options: defaultSelectOptions(t) }
        : newColType === "formula"
          ? {
              formula: newColFormula.trim(),
              formulaResultType: "auto" as const,
            }
          : newColConfig;
    setAddingBusy(true);
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
      setNewColConfig({});
      setAddingCol(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("addColumnFailed"));
    } finally {
      setAddingBusy(false);
    }
  };

  const patchColumn = async (
    columnId: string,
    data: Parameters<typeof api.patchColumn>[1],
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
      setError(e instanceof Error ? e.message : t("updateColumnFailed"));
      throw e;
    }
  };

  const deleteColumn = async (columnId: string) => {
    await api.deleteColumn(columnId);
    setSettingsCol(null);
    updateLocal({
      ...table,
      columns: table.columns.filter((c) => c.id !== columnId),
    });
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
      setError(e instanceof Error ? e.message : t("reorderColumnFailed"));
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
        columns: table.columns.map((c) =>
          c.id === colId ? { ...c, width: w } : c,
        ),
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
    <div className="flex h-full min-h-0 flex-col gap-3">
      {displayError && (
        <div className="flex shrink-0 items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>{displayError}</span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              windowed.setError(null);
            }}
            className="underline"
          >
            {t("close")}
          </button>
        </div>
      )}

      <div className="shrink-0">
        <FilterBar
          sampleRows={filterSamples.current.rows}
          columns={sortedCols}
          filters={filters}
          filterLogic={filterLogic}
          onChange={(f, logic) => {
            setFilters(f);
            setFilterLogic(logic);
          }}
        />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <ArrowUpDown className="h-3.5 w-3.5" />
        {windowed.loading ? (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> {t("loading")}
          </span>
        ) : (
          <span>
            {t("matchedRows", { matched: windowed.totalMatched.toLocaleString(), total: (table.rowCount ?? 0).toLocaleString() })}
          </span>
        )}
        {sort && (
          <button
            type="button"
            className="underline"
            onClick={() => setSort(null)}
          >
            {t("clearSort")}
          </button>
        )}
        {hiddenCols.length > 0 && (
          <div className="flex items-center gap-1">
            <EyeOff className="h-3.5 w-3.5" />
            {t("hiddenPrefix")}
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



      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
        <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" data-testid="table-scroll">
          <div style={{ width: totalWidth, minWidth: "100%" }}>
        {/* Header and rows share one scroll surface on both axes. */}
        <div className="sticky top-0 z-10 border-b border-border bg-muted">
          <div
            className="flex h-9 min-w-max text-sm font-medium text-muted-foreground"
            style={{ width: totalWidth }}
          >
            <div className="flex w-12 shrink-0 items-center justify-center text-muted-foreground">
              #
            </div>
            {visibleCols.map((col) => (
              <div
                key={col.id}
                data-col-header={col.name}
                data-col-type={col.type}
                className="group/column-header relative flex h-9 shrink-0 items-center gap-1 px-1"
                style={{ width: col.width, minWidth: col.width }}
              >
                <span className="text-muted-foreground">
                  <ColumnTypeIcon type={col.type as ColumnType} className="size-3.5" />
                </span>
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-sm font-medium"
                  onClick={() => col.type !== "relation" && toggleSort(col.id)}
                  title={col.type === "relation" ? t("relationField") : t("clickToSort")}
                >
                  {col.name}
                  {sort?.columnId === col.id && (
                    <span className="ml-1 text-[10px] text-primary">
                      {sort.direction === "asc" ? "↑" : "↓"}
                    </span>
                  )}
                </button>
                <Popover open={settingsCol?.id === col.id} onOpenChange={(open) => { setAddingCol(false);setSettingsCol(open ? col : null); }}>
                  <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent",
                    "pointer-events-none opacity-0 group-hover/column-header:pointer-events-auto group-hover/column-header:opacity-100 group-focus-within/column-header:pointer-events-auto group-focus-within/column-header:opacity-100",
                    "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
                    settingsCol?.id === col.id &&
                      "pointer-events-auto opacity-100",
                  )}
                  aria-label={t("columnSettingsNamed", { name: col.name })}
                  title={t("columnSettings")}
                  onClick={() => {
                    setAddingCol(false);
                    setSettingsCol(col);
                  }}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[360px] max-h-[min(70vh,640px)] overflow-auto p-4" align="end" aria-label={t("columnSettingsNamed", { name: col.name })}>
                    {settingsCol?.id === col.id && (

        <ColumnSettings
          key={settingsCol.id}
          column={settingsCol}
          allColumns={table.columns}
          onClose={() => setSettingsCol(null)}
          onSave={async (patch) => {
            await patchColumn(settingsCol.id, patch);
          }}
          onDelete={() =>
            setDeleteTarget({ kind: "column", column: settingsCol })
          }
          onHide={() => {
            void patchColumn(settingsCol.id, {
              config: { ...settingsCol.config, hidden: true },
            });
            setSettingsCol(null);
          }}
          onMove={(dir) => void moveColumn(settingsCol.id, dir)}
        />
                    )}
                  </PopoverContent>
                </Popover>
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
            <Popover open={addingCol} onOpenChange={(open) => { setSettingsCol(null);setAddingCol(open); }}>
              <PopoverTrigger asChild>
            <button
              type="button"
              className="flex w-11 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
              title={t("addColumn")}
              aria-label={t("addColumn")}
              onClick={() => {
                setSettingsCol(null);
                setAddingCol(true);
              }}
            >
              <Plus className="h-4 w-4" />
            </button>
              </PopoverTrigger>
              <PopoverContent className="w-[360px] max-h-[min(70vh,640px)] overflow-auto p-4" align="end" aria-label={t("addColumn")}>

        <div
          className="w-full shrink-0"
          role="region"
          aria-label={t("addColumn")}
          data-testid="add-column-editor"
        >
          <div className="space-y-1">
            <h3 className="mb-3 text-base font-semibold">{t("addColumn")}</h3>
            <Label className="mb-1 block">{t("columnName")}</Label>
            <Input
              className="mb-3"
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              placeholder={t("columnNamePlaceholder")}
              autoFocus
            />
            <Label className="mb-1 block">{t("columnType")}</Label>
            <Select
              value={newColType}
              onValueChange={(v) => {
                setNewColType(v as ColumnType);
                setNewColConfig({});
              }}
            >
              <SelectTrigger className="mb-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent><SelectGroup>
                {(Object.keys(COLUMN_TYPE_LABELS) as ColumnType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    <ColumnTypeIcon type={t} />{COLUMN_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectGroup></SelectContent>
            </Select>
            {(newColType === "relation" || newColType === "rollup") && (
              <RelationColumnConfig
                type={newColType}
                config={newColConfig}
                onChange={setNewColConfig}
                columns={table.columns}
              />
            )}
            {newColType === "file" && <Label className="mb-3 flex items-center justify-between gap-2">{t("files.multiple")}<Switch checked={newColConfig.file?.multiple !== false} onCheckedChange={multiple => setNewColConfig({ ...newColConfig, file: { multiple } })} /></Label>}
            {newColType === "formula" && (
              <div className="mb-4">
                <Label className="mb-1 block">{t("formulaLabel")}</Label>
                <Textarea
                  className="min-h-[72px] font-mono text-sm"
                  value={newColFormula}
                  onChange={(e) => setNewColFormula(e.target.value)}
                  placeholder={t("formulaExample")}
                  spellCheck={false}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t("formulaHelpShort")}
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddingCol(false)}>
                <X data-icon="inline-start" />{t("cancel")}
              </Button>
              <Button disabled={addingBusy} onClick={() => void addColumn()}>
                {addingBusy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Plus data-icon="inline-start" />}{addingBusy ? t("adding") : t("add")}
              </Button>
            </div>
          </div>
        </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* virtual body */}
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
                    transform: `translateY(${vi.start - HEADER_H}px)`,
                    width: totalWidth,
                  }}
                >
                  <div className="group flex w-12 shrink-0 items-center justify-center gap-1 text-xs text-muted-foreground">
                    {row ? (
                      <>
                        <span className="group-hover:hidden">
                          {vi.index + 1}
                        </span>
                        <button
                          type="button"
                          className="hidden rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:inline-flex"
                          title={t("deleteRow")}
                          onClick={() => setDeleteTarget({ kind: "row", row })}
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
                          "group/cell relative flex h-9 shrink-0 items-center border-r border-border/50 px-2",
                          col.type === "formula" || col.type === "rollup"
                            ? "cursor-default bg-muted/40"
                            : "cursor-pointer hover:bg-accent hover:shadow-[inset_0_0_0_1px_var(--primary)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
                          col.type !== "formula" &&
                            col.type !== "rollup" &&
                            col.type !== "checkbox" &&
                            "pr-7",
                          isEditing && "bg-background outline-none ring-2 ring-inset ring-primary focus:outline-none focus-within:outline-none",
                        )}
                        role={
                          col.type === "formula" ||
                          col.type === "rollup" ||
                          isEditing
                            ? undefined
                            : "button"
                        }
                        aria-pressed={
                          col.type === "checkbox" ? Boolean(value) : undefined
                        }
                        tabIndex={
                          col.type === "formula" ||
                          col.type === "rollup" ||
                          isEditing
                            ? undefined
                            : 0
                        }
                        aria-label={t("cellAria", { name: col.name, hint: col.type === "formula" || col.type === "rollup" ? t("readonlyHint") : t("clickToEdit") })}
                        style={{ width: col.width, minWidth: col.width }}
                        onClick={() => {
                          if (col.type === "formula" || col.type === "rollup")
                            return;
                          if (col.type === "checkbox") {
                            void commitCell(row, col.id, !Boolean(value));
                            return;
                          }
                          if (!isEditing)
                            setEditing({ rowId: row.id, colId: col.id });
                        }}
                        onKeyDown={(e) => {
                          if (
                            e.target !== e.currentTarget ||
                            col.type === "formula" ||
                            col.type === "rollup"
                          )
                            return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            if (col.type === "checkbox")
                              void commitCell(row, col.id, !Boolean(value));
                            else setEditing({ rowId: row.id, colId: col.id });
                          }
                        }}
                        title={
                          col.type === "formula" || col.type === "rollup"
                            ? t("formulaPrefix", { formula: col.config?.formula ?? "" })
                            : col.type === "checkbox"
                              ? t("clickToggleCheck")
                              : t("clickEditEnter")
                        }
                      >
                        {isEditing ? (
                          <CellEditor
                            column={col}
                            row={row}
                            onRowUpdated={windowed.upsertRow}
                            value={value}
                            members={members}
                            onCommit={(v) => commitCell(row, col.id, v)}
                            onCancel={() => setEditing(null)}
                          />
                        ) : (
                          <>
                            <div className="flex min-w-0 flex-1 items-center overflow-hidden">
                              <CellDisplay
                                column={col}
                                value={value}
                                members={members}
                                relation={row.relations?.[col.id]}
                              />
                            </div>
                            {col.type !== "formula" &&
                              col.type !== "rollup" &&
                              col.type !== "checkbox" && (
                                <span
                                  className="pointer-events-none absolute right-1.5 text-muted-foreground opacity-0 group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100"
                                  aria-hidden
                                >
                                  {[
                                    "select",
                                    "multi_select",
                                    "person",
                                    "date",
                                  ].includes(col.type) ? (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  ) : (
                                    <Pencil className="h-3 w-3" />
                                  )}
                                </span>
                              )}
                          </>
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
        </div>

        <button
          type="button"
          onClick={() => void addRow()}
          className="flex w-full shrink-0 items-center gap-2 border-t border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
        >
          <Plus className="h-4 w-4" />
          {t("newRow")}
        </button>
      </div>

      <DeleteConfirmation
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={deleteTarget?.kind === "column" ? t("deleteColumnQ") : t("deleteRecordQ")}
        description={
          deleteTarget?.kind === "column"
            ? deleteTarget.column.type === "relation"
              ? t("deleteRelationColumnDesc", { name: deleteTarget.column.name })
              : t("deleteColumnDesc", { name: deleteTarget.column.name })
            : t("deleteRecordDesc")
        }
        onConfirm={async () => {
          if (deleteTarget?.kind === "row") await deleteRow(deleteTarget.row);
          else if (deleteTarget?.kind === "column")
            await deleteColumn(deleteTarget.column.id);
        }}
      />
    </div>
  );
}
