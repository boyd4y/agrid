import { RelationPicker } from "./RelationPicker";
import { useEffect, useRef, useState } from "react";
import { FormFieldControl } from "@/components/form/FormFieldControls";
import { useMemberOptions } from "@/hooks/useMemberOptions";
import {
  changedFilterOperator,
  filterOpsForColumn,
  filterValueType,
  parseFilterNumber,
} from "@/lib/filter-value";
import { Plus, Trash2, Filter, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { DatePicker } from "@/components/controls/date-picker";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tabdo/ui/components/select";
import type { ColumnDef, CellValue } from "@/types/table";
import { SelectChip } from "./SelectChip";
import { useTranslation } from "react-i18next";
import {
  filterNeedsValue,
  isFilterConditionComplete,
  type RowData,
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
  sampleRows?: RowData[];
};

export function FilterBar({
  columns,
  filters,
  filterLogic,
  onChange,
  defaultOpen = false,
  sampleRows = [],
}: Props) {
  const { t } = useTranslation("table");
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
    const op = filterOpsForColumn(col, sampleRows)[0];
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
    <div className="mb-3 rounded-lg border border-border bg-muted/60 px-3 py-2">
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
          {t("filter")}
          {filters.length > 0 && (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              {activeCount > 0 ? activeCount : filters.length}
            </span>
          )}
        </Button>
        {!open && filters.length === 0 && (
          <span className="text-[11px] text-muted-foreground">
            {t("filterCollapsed")}
          </span>
        )}
        {!open && filters.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {activeCount > 0
              ? t("filterActive", { count: activeCount })
              : t("filterIncomplete", { count: filters.length })}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 text-xs"
          onClick={add}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("conditions")}
        </Button>
        {filters.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => onChange([], filterLogic)}
          >
            {t("clearFilters")}
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
                  {l === "and" ? t("logicAnd") : t("logicOr")}
                </Button>
              ))}
            </div>
          )}

          {filters.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              {t("noFiltersHint")}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {filters.map((f, idx) => {
                const col =
                  columns.find((c) => c.id === f.columnId) ?? visibleCols[0];
                const ops = filterOpsForColumn(col, sampleRows);
                const needsValue = filterNeedsValue(f.op);
                return (
                  <div
                    key={f.id}
                    data-testid="filter-condition"
                    className="flex flex-wrap items-center gap-1.5"
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
                        const nextOp = filterOpsForColumn(
                          nextCol,
                          sampleRows,
                        )[0];
                        update(f.id, {
                          columnId: v,
                          op: nextOp,
                          value: null,
                        });
                      }}
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={t("columnPlaceholder")}
                        className="w-[120px] shrink-0"
                      >
                        <SelectValue placeholder={t("columnPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {visibleCols.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <Select
                      value={f.op}
                      onValueChange={(v) =>
                        update(f.id, changedFilterOperator(v as FilterOp))
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={t("opPlaceholder")}
                        className="w-[110px] shrink-0"
                      >
                        <SelectValue placeholder={t("opPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {ops.map((op) => (
                            <SelectItem key={op} value={op}>
                              {t(`filterOps.${op}`)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {needsValue && col && (
                      <FilterValueInput
                        key={`${col.id}:${f.op}`}
                        sampleRows={sampleRows}
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
  sampleRows = [],
}: {
  column: ColumnDef;
  value: CellValue;
  onChange: (v: CellValue) => void;
  sampleRows?: Pick<RowData, "cells">[];
}) {
  const { t } = useTranslation("table");
  const { t: tf } = useTranslation("filters");
  const type = filterValueType(column, sampleRows);
  const label = tf("valueFor", { name: column.name });
  if (type === "person")
    return (
      <PersonFilterInput
        column={column}
        value={value}
        onChange={onChange}
        label={label}
      />
    );
  if (type === "relation")
    return (
      <div
        className="w-44 shrink-0"
        data-testid="filter-value"
        data-filter-type={type}
      >
        <RelationPicker
          column={{
            ...column,
            config: {
              ...column.config,
              relation: { ...column.config.relation!, limit: "one" },
            },
          }}
          value={
            typeof value === "string"
              ? [value]
              : Array.isArray(value)
                ? value.slice(0, 1)
                : []
          }
          onChange={(ids) => onChange(ids[0] ?? null)}
        />
      </div>
    );
  if (type === "select" || type === "multi_select") {
    const options = column.config?.options ?? [];
    const selected =
      typeof value === "string"
        ? value
        : Array.isArray(value)
          ? value[0]
          : null;
    const current = options.find((o) => o.id === selected);
    return (
      <Select
        value={selected || "__empty__"}
        onValueChange={(v) => onChange(v === "__empty__" ? null : v)}
      >
        <SelectTrigger
          size="sm"
          className="w-44 shrink-0"
          aria-label={label}
          data-testid="filter-value"
          data-filter-type={type}
        >
          {current ? (
            <SelectChip option={current} />
          ) : (
            <span className="text-muted-foreground">{t("selectEllipsis")}</span>
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="__empty__">{t("selectEllipsis")}</SelectItem>
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                <SelectChip option={option} />
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    );
  }
  if (type === "checkbox")
    return (
      <Select
        value={value === true ? "1" : value === false ? "0" : "__empty__"}
        onValueChange={(v) => onChange(v === "__empty__" ? null : v === "1")}
      >
        <SelectTrigger
          size="sm"
          className="w-32 shrink-0"
          aria-label={label}
          data-testid="filter-value"
          data-filter-type={type}
        >
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="__empty__">—</SelectItem>
            <SelectItem value="1">{t("checked")}</SelectItem>
            <SelectItem value="0">{t("unchecked")}</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    );
  if (type === "number")
    return (
      <NumberFilterInput value={value} onChange={onChange} label={label} />
    );
  if (type === "date")
    return (
      <div
        className="w-44 shrink-0"
        data-testid="filter-value"
        data-filter-type={type}
      >
        <DatePicker
          value={typeof value === "string" ? value : null}
          onChange={onChange}
          dateFormat={column.config?.dateFormat ?? "YYYY-MM-DD"}
          placeholder={label}
        />
      </div>
    );
  return (
    <Input
      size="sm"
      className="w-44 shrink-0"
      aria-label={label}
      data-testid="filter-value"
      data-filter-type={type}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value || null)}
      placeholder={t("valuePlaceholder")}
    />
  );
}

function PersonFilterInput({
  column,
  value,
  onChange,
  label,
}: {
  column: ColumnDef;
  value: CellValue;
  onChange: (value: CellValue) => void;
  label: string;
}) {
  const members = useMemberOptions();
  return (
    <div
      className="w-44 shrink-0"
      data-testid="filter-value"
      data-filter-type="person"
    >
      <FormFieldControl
        column={column}
        value={value}
        onChange={onChange}
        members={members}
        placeholder={label}
      />
    </div>
  );
}

function NumberFilterInput({
  value,
  onChange,
  label,
}: {
  value: CellValue;
  onChange: (value: CellValue) => void;
  label: string;
}) {
  const { t } = useTranslation("filters");
  const [draft, setDraft] = useState(
    typeof value === "number" ? String(value) : "",
  );
  const emitted = useRef(value);
  useEffect(() => {
    if (!Object.is(value, emitted.current)) {
      setDraft(typeof value === "number" ? String(value) : "");
      emitted.current = value;
    }
  }, [value]);
  const invalid = Boolean(draft.trim()) && parseFilterNumber(draft) === null;
  return (
    <Input
      size="sm"
      inputMode="decimal"
      className="w-32 shrink-0"
      aria-label={label}
      aria-invalid={invalid}
      title={invalid ? t("invalidNumber") : undefined}
      data-testid="filter-value"
      data-filter-type="number"
      value={draft}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        emitted.current = parseFilterNumber(raw);
        onChange(emitted.current);
      }}
    />
  );
}
