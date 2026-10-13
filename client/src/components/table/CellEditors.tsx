import { MemberAvatar } from "@/components/members/MemberAvatar";
import { MemberChip } from "@/components/members/MemberChip";
import { RelationPicker, RelationTags } from "./RelationPicker";
import { useState, type KeyboardEvent } from "react";
import { Check, Search, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { DatePicker } from "@/components/ui/date-picker";
import { formatDateDisplay } from "@/lib/date-format";
import { cn } from "@/lib/utils";
import { SelectChip } from "./SelectChip";
import type { CellValue, ColumnDef, SelectOption } from "@/types/table";
import type { MemberOption } from "@/lib/api";

type EditorProps = {
  column: ColumnDef;
  value: CellValue;
  onCommit: (value: CellValue) => void;
  onCancel: () => void;
  members?: MemberOption[];
  row?: import("@/types/table").RowData;
  onRowUpdated?: (row: import("@/types/table").RowData) => void;
};

const OPTION_CLASS =
  "flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-1 focus-visible:ring-primary";
const CELL_POPOVER_CLASS = "w-64 p-1";

function CellOptionSearch({
  value,
  onChange,
  placeholder,
  onClear,
  canClear,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onClear: () => void;
  canClear: boolean;
}) {
  return (
    <div className="mb-1 flex items-center gap-1 border-b border-border px-2 py-1.5">
      <Search
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <Input
        size="sm"
        className="h-7 min-w-0 flex-1 rounded-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
        placeholder={placeholder}
        aria-label={placeholder.replace(/…$/, "")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus
      />
      <button
        type="button"
        aria-label="清除所选值"
        title="清除所选值"
        disabled={!canClear}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-30"
        onClick={onClear}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function navigateOptions(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const buttons = Array.from(
    e.currentTarget.querySelectorAll<HTMLButtonElement>(
      "button[data-cell-option]:not(:disabled)",
    ),
  );
  if (!buttons.length) return;
  e.preventDefault();
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    index < 0
      ? e.key === "ArrowDown"
        ? 0
        : buttons.length - 1
      : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
        buttons.length;
  buttons[next].focus();
}

export function CellDisplay({
  column,
  value,
  members = [],
  relation,
}: {
  column: ColumnDef;
  value: CellValue;
  members?: MemberOption[];
  relation?: {
    records: import("@/types/table").RelatedRecord[];
    total: number;
  };
}) {
  const options = column.config?.options ?? [];

  switch (column.type) {
    case "relation":
      return (
        <RelationTags
          records={relation?.records ?? []}
          total={relation?.total ?? 0}
        />
      );
    case "checkbox":
      return (
        <div className="flex w-full items-center justify-center" aria-hidden>
          <span
            className={cn(
              "flex h-4 w-4 items-center justify-center rounded border",
              value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/60 bg-background",
            )}
          >
            {Boolean(value) && <Check className="h-3 w-3" />}
          </span>
        </div>
      );
    case "select": {
      const opt = options.find((o) => o.id === value);
      return opt ? (
        <SelectChip option={opt} />
      ) : (
        <span className="text-muted-foreground/50">—</span>
      );
    }
    case "multi_select": {
      const ids = Array.isArray(value) ? value : [];
      const selected = options.filter((o) => ids.includes(o.id));
      if (!selected.length)
        return <span className="text-muted-foreground/50">—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {selected.map((o) => (
            <SelectChip key={o.id} option={o} />
          ))}
        </div>
      );
    }
    case "person": {
      if (!value) return <span className="text-muted-foreground/50">空</span>;
      const m = members.find((x) => x.userId === value || x.name === value);
      const label = m?.name ?? String(value);
      return <MemberChip name={label} kind={m?.kind} image={m?.image} />;
    }
    case "rollup":
    case "formula": {
      const err =
        typeof value === "string" && value.startsWith("#ERR:")
          ? value.slice(5)
          : null;
      if (err) {
        return (
          <span className="truncate text-xs text-destructive" title={err}>
            #ERR
          </span>
        );
      }
      return (
        <span className="truncate font-mono text-[13px] tabular-nums text-muted-foreground">
          {value === null || value === undefined || value === "" ? (
            <span className="font-sans text-muted-foreground/50">—</span>
          ) : (
            String(value)
          )}
        </span>
      );
    }
    case "number":
      return (
        <span className="w-full text-right tabular-nums">
          {value === null || value === undefined || value === "" ? (
            <span className="text-muted-foreground/50">—</span>
          ) : (
            String(value)
          )}
        </span>
      );
    case "date": {
      if (value === null || value === undefined || value === "") {
        return <span className="text-muted-foreground/50">空</span>;
      }
      const fmt = column.config?.dateFormat ?? "YYYY-MM-DD";
      return (
        <span className="truncate text-[13px]">
          {formatDateDisplay(String(value), fmt)}
        </span>
      );
    }
    case "text":
    default:
      return (
        <span className="truncate">
          {value === null || value === undefined || value === "" ? (
            <span className="text-muted-foreground/50">空</span>
          ) : (
            String(value)
          )}
        </span>
      );
  }
}

export function CellEditor({
  column,
  value,
  onCommit,
  onCancel,
  members = [],
  row,
  onRowUpdated,
}: EditorProps) {
  if (column.type === "relation")
    return (
      <RelationPicker
        column={column}
        value={Array.isArray(value) ? value : []}
        rowId={row?.id}
        rowVersion={row?.version}
        records={row?.relations?.[column.id]?.records}
        onUpdated={onRowUpdated}
        onChange={onCommit}
        embedded
        onClose={onCancel}
      />
    );
  if (column.type === "formula" || column.type === "rollup") {
    return (
      <div className="flex h-full w-full items-center px-1 text-xs text-muted-foreground">
        公式列只读
      </div>
    );
  }

  if (column.type === "checkbox") {
    return (
      <div className="flex h-full items-center justify-center px-2">
        <Checkbox
          checked={Boolean(value)}
          onCheckedChange={(checked) => onCommit(Boolean(checked))}
          autoFocus
        />
      </div>
    );
  }

  if (column.type === "select") {
    return (
      <SelectEditor
        options={column.config?.options ?? []}
        value={typeof value === "string" ? value : null}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    );
  }

  if (column.type === "multi_select") {
    return (
      <MultiSelectEditor
        options={column.config?.options ?? []}
        value={Array.isArray(value) ? value : []}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    );
  }

  if (column.type === "person") {
    return (
      <PersonEditor
        members={members}
        value={typeof value === "string" ? value : null}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    );
  }

  if (column.type === "date") {
    return (
      <DatePicker
        embedded
        autoOpen
        value={typeof value === "string" ? value : null}
        dateFormat={column.config?.dateFormat ?? "YYYY-MM-DD"}
        onChange={(v) => onCommit(v)}
        onCancel={onCancel}
      />
    );
  }

  if (column.type === "number") {
    return (
      <Input
        inputMode="decimal"
        className="h-full border-0 bg-transparent text-right shadow-none tabular-nums focus-visible:ring-0"
        defaultValue={typeof value === "number" ? String(value) : ""}
        autoFocus
        onBlur={(e) => {
          const v = e.target.value;
          if (v === "") return onCommit(null);
          const n = Number(v);
          onCommit(Number.isNaN(n) ? null : n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const v = (e.target as HTMLInputElement).value;
            if (v === "") return onCommit(null);
            const n = Number(v);
            onCommit(Number.isNaN(n) ? null : n);
          }
          if (e.key === "Escape") onCancel();
        }}
      />
    );
  }

  return (
    <Input
      className="h-full border-0 bg-transparent shadow-none focus-visible:ring-0"
      defaultValue={typeof value === "string" ? value : ""}
      autoFocus
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit((e.target as HTMLInputElement).value);
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}

function PersonEditor({
  members,
  value,
  onCommit,
  onCancel,
}: {
  members: MemberOption[];
  value: string | null;
  onCommit: (v: CellValue) => void;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState("");

  const list = members.filter(
    (m) =>
      !q ||
      m.name.toLowerCase().includes(q.toLowerCase()) ||
      m.email.toLowerCase().includes(q.toLowerCase()),
  );

  const current = members.find((x) => x.userId === value || x.name === value);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onCancel();
      }}
    >
      <PopoverAnchor asChild>
        <div className="flex h-full w-full items-center">
          {current ? (
            <MemberChip name={current.name} kind={current.kind} image={current.image} />
          ) : (
            <span className="text-muted-foreground/50">空</span>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        alignOffset={-8}
        side="bottom"
        sideOffset={6}
        className={CELL_POPOVER_CLASS}
        aria-label="选择人员"
        onKeyDown={navigateOptions}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <CellOptionSearch
          placeholder="搜索人员…"
          value={q}
          onChange={setQ}
          onClear={() => onCommit(null)}
          canClear={Boolean(value)}
        />
        {list.length === 0 && (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            暂无成员
          </div>
        )}
        <div className="max-h-56 overflow-y-auto">
          {list.map((m) => (
            <button
              key={m.userId}
              type="button"
              data-cell-option
              aria-pressed={value === m.userId || value === m.name}
              className={cn(
                OPTION_CLASS,
                (value === m.userId || value === m.name) && "bg-accent",
              )}
              onClick={() => onCommit(m.userId)}
            >
              <MemberAvatar name={m.name} kind={m.kind} image={m.image} className="size-5" />
              <span className="truncate">{m.name}</span>
              {(value === m.userId || value === m.name) && (
                <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
            </button>
          ))}
        </div>
        {members.length === 0 && (
          <Input
            size="sm"
            className="mt-1 h-8"
            placeholder="或输入人名后回车"
            onKeyDown={(e) => {
              if (e.key === "Enter")
                onCommit((e.target as HTMLInputElement).value || null);
              if (e.key === "Escape") onCancel();
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Single-select commits and closes when an option is picked. */
function SelectEditor({
  options,
  value,
  onCommit,
  onCancel,
}: {
  options: SelectOption[];
  value: string | null;
  onCommit: (v: CellValue) => void;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState("");
  const current = options.find((o) => o.id === value) ?? null;
  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onCancel();
      }}
    >
      <PopoverAnchor asChild>
        <div className="flex h-full w-full items-center">
          {current ? (
            <SelectChip option={current} />
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        alignOffset={-8}
        side="bottom"
        sideOffset={6}
        className={CELL_POPOVER_CLASS}
        aria-label="选择选项"
        onKeyDown={navigateOptions}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <CellOptionSearch
          placeholder="搜索选项…"
          value={q}
          onChange={setQ}
          onClear={() => onCommit(null)}
          canClear={Boolean(value)}
        />
        <div className="max-h-56 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              没有匹配的选项
            </p>
          )}
          {filtered.map((o) => {
            const selected = value === o.id;
            return (
              <button
                key={o.id}
                type="button"
                data-cell-option
                aria-pressed={selected}
                className={cn(OPTION_CLASS, selected && "bg-accent")}
                onClick={() => onCommit(o.id)}
              >
                <SelectChip option={o} />
                {selected && (
                  <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Multi-select like Notion: click toggles immediately, no confirm/cancel footer.
 * Closing the popover commits the current selection.
 */
function MultiSelectEditor({
  options,
  value,
  onCommit,
  onCancel,
}: {
  options: SelectOption[];
  value: string[];
  onCommit: (v: CellValue) => void;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<string[]>(value);
  const [dirty, setDirty] = useState(false);
  const [q, setQ] = useState("");
  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(q.trim().toLowerCase()),
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      setDirty(true);
      return next;
    });
  };

  const selectedOpts = options.filter((o) => selected.includes(o.id));

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          if (dirty) onCommit(selected);
          else onCancel();
        }
      }}
    >
      <PopoverAnchor asChild>
        <div className="flex h-full w-full items-center gap-1 overflow-hidden">
          {selectedOpts.length === 0 ? (
            <span className="text-muted-foreground/50">—</span>
          ) : (
            selectedOpts.map((o) => <SelectChip key={o.id} option={o} />)
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        alignOffset={-8}
        side="bottom"
        sideOffset={6}
        className={CELL_POPOVER_CLASS}
        aria-label="选择多个选项"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          navigateOptions(e);
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            if (dirty) onCommit(selected);
            else onCancel();
          }
        }}
      >
        <CellOptionSearch
          placeholder="搜索选项…"
          value={q}
          onChange={setQ}
          onClear={() => {
            setSelected([]);
            setDirty(true);
          }}
          canClear={selected.length > 0}
        />
        <div className="flex min-h-8 flex-wrap items-center gap-1 px-2 py-1.5">
          {selectedOpts.length === 0 ? (
            <span className="text-[12px] text-muted-foreground">
              点击选择标签
            </span>
          ) : (
            selectedOpts.map((o) => (
              <SelectChip key={o.id} option={o} onRemove={() => toggle(o.id)} />
            ))
          )}
        </div>
        <div className="my-1 h-px bg-border" />
        <div className="max-h-56 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              没有匹配的选项
            </p>
          )}
          {filtered.map((o) => {
            const on = selected.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                data-cell-option
                aria-pressed={on}
                className={cn(OPTION_CLASS, on && "bg-accent")}
                onClick={() => toggle(o.id)}
              >
                <span
                  className={cn(
                    "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                    on
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-transparent",
                  )}
                  aria-hidden
                >
                  {on && <Check className="h-2.5 w-2.5" />}
                </span>
                <SelectChip option={o} />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
