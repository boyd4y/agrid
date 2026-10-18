import { FileDisplay, FileCellEditor } from "./FileField";
import { MemberAvatar } from "@/components/members/MemberAvatar";
import { MemberChip } from "@/components/members/MemberChip";
import { RelationPicker, RelationTags } from "./RelationPicker";
import { useState } from "react";
import { Check } from "lucide-react";
import { Checkbox } from "@tabdo/ui/components/checkbox";
import { Input } from "@tabdo/ui/components/input";
import {
  Popover,
  PopoverAnchor,
} from "@tabdo/ui/components/popover";
import { DatePicker } from "@/components/controls/date-picker";
import { formatDateDisplay } from "@/lib/date-format";
import { cn } from "@/lib/utils";
import { SelectChip } from "./SelectChip";
import { CellOptionPanel } from "./CellOptionPanel";
import { SelectOptionRow, CELL_OPTION_CLASS } from "./SelectOptionRow";
import type { CellValue, ColumnDef, SelectOption } from "@/types/table";
import type { MemberOption } from "@/lib/api";
import i18n from "@/i18n";

type EditorProps = {
  column: ColumnDef;
  value: CellValue;
  onCommit: (value: CellValue) => void | Promise<void>;
  onCancel: () => void;
  members?: MemberOption[];
  row?: import("@/types/table").RowData;
  onRowUpdated?: (row: import("@/types/table").RowData) => void;
};

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
    case "file":
      return <FileDisplay value={value} />;
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
      if (!value) return <span className="text-muted-foreground/50">{i18n.t("table:empty")}</span>;
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
          <span className="block min-w-0 max-w-full truncate text-xs text-destructive" title={err}>
            #ERR
          </span>
        );
      }
      return (
        <span className="block min-w-0 max-w-full truncate font-mono text-[13px] tabular-nums text-muted-foreground">
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
        <span className="block min-w-0 w-full truncate text-right tabular-nums">
          {value === null || value === undefined || value === "" ? (
            <span className="text-muted-foreground/50">—</span>
          ) : (
            String(value)
          )}
        </span>
      );
    case "date": {
      if (value === null || value === undefined || value === "") {
        return <span className="text-muted-foreground/50">{i18n.t("table:empty")}</span>;
      }
      const fmt = column.config?.dateFormat ?? "YYYY-MM-DD";
      return (
        <span className="block min-w-0 max-w-full truncate text-[13px]">
          {formatDateDisplay(String(value), fmt)}
        </span>
      );
    }
    case "text":
    default:
      return (
        <span className="block min-w-0 max-w-full truncate">
          {value === null || value === undefined || value === "" ? (
            <span className="text-muted-foreground/50">{i18n.t("table:empty")}</span>
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
  if (column.type === "file") return <FileCellEditor column={column} value={value} onChange={onCommit} onClose={onCancel} />;
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
        {i18n.t("table:formulaReadonly")}
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
            <span className="text-muted-foreground/50">{i18n.t("table:empty")}</span>
          )}
        </div>
      </PopoverAnchor>
      <CellOptionPanel
        label={i18n.t("table:pickPerson")}
        search={{
          placeholder: i18n.t("table:searchPeople"),
          value: q,
          onChange: setQ,
          onClear: () => onCommit(null),
          canClear: Boolean(value),
        }}
        items={list}
        renderOption={(m) => (
          <button
            key={m.userId}
            type="button"
            data-cell-option
            aria-pressed={value === m.userId || value === m.name}
            className={cn(
              CELL_OPTION_CLASS,
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
        )}
        beforeList={list.length === 0 && (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            {i18n.t("table:noMembers")}
          </div>
        )}
        afterList={members.length === 0 && (
          <Input
            size="sm"
            className="mt-1 h-8"
            placeholder={i18n.t("table:orTypeNameEnter")}
            onKeyDown={(e) => {
              if (e.key === "Enter")
                onCommit((e.target as HTMLInputElement).value || null);
              if (e.key === "Escape") onCancel();
            }}
          />
        )}
      />
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
      <CellOptionPanel
        label={i18n.t("table:pickOption")}
        search={{
          placeholder: i18n.t("table:searchOptions"),
          value: q,
          onChange: setQ,
          onClear: () => onCommit(null),
          canClear: Boolean(value),
        }}
        items={filtered}
        renderOption={(o) => (
          <SelectOptionRow
            key={o.id}
            option={o}
            surface="cell"
            selected={value === o.id}
            onSelect={() => onCommit(o.id)}
          />
        )}
        emptyState={
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {i18n.t("table:noMatchingOptions")}
          </p>
        }
      />
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
      <CellOptionPanel
        label={i18n.t("table:pickOptions")}
        search={{
          placeholder: i18n.t("table:searchOptions"),
          value: q,
          onChange: setQ,
          onClear: () => {
            setSelected([]);
            setDirty(true);
          },
          canClear: selected.length > 0,
        }}
        items={filtered}
        renderOption={(o) => (
          <SelectOptionRow
            key={o.id}
            option={o}
            surface="cell"
            multiple
            selected={selected.includes(o.id)}
            onSelect={() => toggle(o.id)}
          />
        )}
        emptyState={
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {i18n.t("table:noMatchingOptions")}
          </p>
        }
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            if (dirty) onCommit(selected);
            else onCancel();
          }
        }}
        beforeList={
          <>
            <div className="flex min-h-8 flex-wrap items-center gap-1 px-2 py-1.5">
              {selectedOpts.length === 0 ? (
                <span className="text-[12px] text-muted-foreground">
                  {i18n.t("table:clickToPickTags")}
                </span>
              ) : (
                selectedOpts.map((o) => (
                  <SelectChip key={o.id} option={o} onRemove={() => toggle(o.id)} />
                ))
              )}
            </div>
            <div className="my-1 h-px bg-border" />
          </>
        }
      />
    </Popover>
  );
}
