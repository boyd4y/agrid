import { RelationPicker } from "./RelationPicker";
import { useState } from "react";
import { Plus, Trash2, Filter, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ColumnDef, CellValue } from "@/types/table";
import { SelectChip } from "./SelectChip";
import {
  FILTER_OP_LABELS,
  filterNeedsValue,
  isFilterConditionComplete,
  opsForType,
  type FilterCondition,
  type FilterLogic,
  type FilterOp,
} from "@tabdo/shared";

type Props = {
  columns: ColumnDef[];
  filters: FilterCondition[];
  filterLogic: FilterLogic;
  onChange: (filters: FilterCondition[], logic: FilterLogic) => void;
  /** Default collapsed to reduce density; expands when filters exist or user opens. */
  defaultOpen?: boolean;
};

export function FilterBar({
  columns,
  filters,
  filterLogic,
  onChange,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen || filters.length > 0);
  const visibleCols = columns.filter((c) => !c.config?.hidden);
  const activeCount = filters.filter(isFilterConditionComplete).length;

  const update = (id: string, patch: Partial<FilterCondition>) => {
    onChange(
      filters.map((f) => (f.id === id ? { ...f, ...patch } : f)),
      filterLogic,
    );
  };

  const add = () => {
    const col = visibleCols[0];
    if (!col) return;
    const op = opsForType(col.type)[0];
    setOpen(true);
    onChange(
      [
        ...filters,
        {
          id: `f_${Date.now()}`,
          columnId: col.id,
          op,
          value: null,
        },
      ],
      filterLogic,
    );
  };

  return (
    <div className="mb-3 rounded-lg border border-border bg-muted/60 px-3 py-2 outline-none ring-0 focus-within:outline-none focus-within:ring-0 [&_*]:outline-none">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-1.5 text-xs font-medium text-foreground"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="filter-toggle"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          筛选
          {filters.length > 0 && (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              {activeCount > 0 ? activeCount : filters.length}
            </span>
          )}
        </Button>
        {!open && filters.length === 0 && (
          <span className="text-[11px] text-muted-foreground">
            已折叠 · 点击展开
          </span>
        )}
        {!open && filters.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {activeCount > 0
              ? `${activeCount} 条条件生效中`
              : `${filters.length} 条条件未填完（暂不生效）`}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 text-xs"
          onClick={add}
        >
          <Plus className="h-3.5 w-3.5" />
          条件
        </Button>
        {filters.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => onChange([], filterLogic)}
          >
            清空
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-2 border-t border-border/70 pt-2">
          {filters.length > 1 && (
            <div className="mb-2 flex rounded-md border border-border bg-background p-0.5 text-[11px] w-fit">
              {(["and", "or"] as FilterLogic[]).map((l) => (
                <Button
                  key={l}
                  type="button"
                  variant={filterLogic === l ? "default" : "ghost"}
                  size="sm"
                  className="h-6 rounded px-2 text-[11px]"
                  onClick={() => onChange(filters, l)}
                >
                  {l === "and" ? "且 AND" : "或 OR"}
                </Button>
              ))}
            </div>
          )}

          {filters.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              无筛选 — 显示全部行。Agent 可用 queryRows 同样条件。
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {filters.map((f, idx) => {
                const col =
                  columns.find((c) => c.id === f.columnId) ?? visibleCols[0];
                const ops = opsForType(col?.type ?? "text");
                const needsValue = filterNeedsValue(f.op);
                return (
                  <div
                    key={f.id}
                    className="flex flex-nowrap items-center gap-1.5 overflow-x-auto"
                  >
                    {idx > 0 ? (
                      <span className="w-8 text-center text-[10px] font-medium uppercase text-muted-foreground">
                        {filterLogic}
                      </span>
                    ) : (
                      <span className="w-8" />
                    )}
                    <Select
                      value={f.columnId}
                      onValueChange={(v) => {
                        const nextCol = columns.find((c) => c.id === v)!;
                        const nextOp = opsForType(nextCol.type)[0];
                        update(f.id, {
                          columnId: v,
                          op: nextOp,
                          value: null,
                        });
                      }}
                    >
                      <SelectTrigger
                        size="sm"
                        className="w-[120px] shrink-0 !ring-0 focus-visible:!ring-1 focus-visible:!ring-[rgba(55,53,47,0.14)] data-[state=open]:!ring-1 data-[state=open]:!ring-[rgba(55,53,47,0.14)]"
                      >
                        <SelectValue placeholder="列" />
                      </SelectTrigger>
                      <SelectContent>
                        {visibleCols.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={f.op}
                      onValueChange={(v) =>
                        update(f.id, { op: v as FilterOp, value: null })
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        className="w-[110px] shrink-0 !ring-0 focus-visible:!ring-1 focus-visible:!ring-[rgba(55,53,47,0.14)] data-[state=open]:!ring-1 data-[state=open]:!ring-[rgba(55,53,47,0.14)]"
                      >
                        <SelectValue placeholder="条件" />
                      </SelectTrigger>
                      <SelectContent>
                        {ops.map((op) => (
                          <SelectItem key={op} value={op}>
                            {FILTER_OP_LABELS[op]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {needsValue && col && (
                      <FilterValueInput
                        column={col}
                        value={f.value ?? null}
                        onChange={(v) => update(f.id, { value: v })}
                      />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        onChange(
                          filters.filter((x) => x.id !== f.id),
                          filterLogic,
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FilterValueInput({
  column,
  value,
  onChange,
}: {
  column: ColumnDef;
  value: CellValue;
  onChange: (v: CellValue) => void;
}) {
  if (column.type === "relation")
    return (
      <div className="w-44 shrink-0">
        <RelationPicker
          column={{
            ...column,
            config: {
              ...column.config,
              relation: { ...column.config.relation!, limit: "one" },
            },
          }}
          value={typeof value === "string" ? [value] : []}
          onChange={(ids) => onChange(ids[0] ?? null)}
        />
      </div>
    );
  if (column.type === "select" || column.type === "multi_select") {
    const options = column.config?.options ?? [];
    const current = options.find((o) => o.id === value);
    return (
      <Select
        value={typeof value === "string" && value ? value : "__empty__"}
        onValueChange={(v) => onChange(v === "__empty__" ? null : v)}
      >
        <SelectTrigger
          size="sm"
          className="h-8 w-[160px] shrink-0 !ring-0 focus-visible:!ring-1 focus-visible:!ring-ring data-[state=open]:!ring-1 data-[state=open]:!ring-ring"
        >
          {current ? (
            <SelectChip option={current} />
          ) : (
            <span className="text-muted-foreground">选择…</span>
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__empty__">
            <span className="text-muted-foreground">选择…</span>
          </SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id} className="pl-8">
              <SelectChip option={o} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (column.type === "checkbox") {
    return (
      <Select
        value={value === true ? "1" : value === false ? "0" : "__empty__"}
        onValueChange={(v) => onChange(v === "__empty__" ? null : v === "1")}
      >
        <SelectTrigger
          size="sm"
          className="w-[100px] shrink-0 !ring-0 focus-visible:!ring-1 focus-visible:!ring-[rgba(55,53,47,0.14)] data-[state=open]:!ring-1 data-[state=open]:!ring-[rgba(55,53,47,0.14)]"
        >
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__empty__">—</SelectItem>
          <SelectItem value="1">勾选</SelectItem>
          <SelectItem value="0">未勾选</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (
    column.type === "number" ||
    (column.type === "rollup" &&
      !["earliest", "latest"].includes(column.config.rollup?.operation ?? ""))
  ) {
    return (
      <Input
        size="sm"
        inputMode="decimal"
        className="w-28 shrink-0"
        value={typeof value === "number" ? String(value) : ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
        placeholder="数字"
      />
    );
  }
  if (
    column.type === "date" ||
    (column.type === "rollup" &&
      ["earliest", "latest"].includes(column.config.rollup?.operation ?? ""))
  ) {
    return (
      <DatePicker
        value={typeof value === "string" ? value : null}
        onChange={(v) => onChange(v)}
        dateFormat={column.config?.dateFormat ?? "YYYY-MM-DD"}
        className="w-40 shrink-0"
        placeholder={column.config?.dateFormat ?? "YYYY-MM-DD"}
      />
    );
  }
  return (
    <Input
      size="sm"
      className="w-[160px] shrink-0"
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value || null)}
      placeholder="值"
    />
  );
}
