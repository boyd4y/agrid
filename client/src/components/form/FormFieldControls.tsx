import { RelationPicker } from "@/components/table/RelationPicker";
import { useState } from "react";
import { Bot, Check, ChevronsUpDown, User } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DatePicker } from "@/components/ui/date-picker";
import { SelectChip } from "@/components/table/SelectChip";
import { cn } from "@/lib/utils";
import type { CellValue, ColumnDef, SelectOption } from "@/types/table";
import type { MemberOption } from "@/lib/api";
import type { FormQuestionSettings } from "@tabdo/shared";

type ControlProps = {
  column: ColumnDef;
  value: CellValue;
  onChange: (v: CellValue) => void;
  placeholder?: string;
  disabled?: boolean;
  members?: MemberOption[];
  settings?: FormQuestionSettings;
  /** Larger Typeform-style controls */
  variant?: "default" | "typeform";
};

export function FormFieldControl({
  column,
  value,
  onChange,
  placeholder,
  disabled,
  members = [],
  settings,
  variant = "default",
}: ControlProps) {
  const tf = variant === "typeform";

  if (column.type === "formula" || column.type === "rollup" || disabled) {
    return (
      <div
        className={cn(
          "rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground",
          tf && "border-[color-mix(in_srgb,var(--form-answer)_20%,transparent)] bg-[color-mix(in_srgb,var(--form-answer)_6%,transparent)]"
        )}
        style={tf ? { borderRadius: "var(--form-radius)" } : undefined}
      >
        {value === null || value === undefined || value === ""
          ? "—"
          : String(value)}
      </div>
    );
  }

  if(column.type==="relation")return <RelationPicker column={column} value={Array.isArray(value)?value:[]} onChange={onChange}/>;
  if (column.type === "checkbox") {
    const agree =
      settings?.kind === "checkbox" ? settings.agreeLabel : undefined;
    return (
      <div className="flex items-center gap-3 pt-1">
        <Checkbox
          checked={Boolean(value)}
          onCheckedChange={(c) => onChange(Boolean(c))}
          className={tf ? "border-[var(--form-answer)] data-[state=checked]:bg-[var(--form-button)] data-[state=checked]:border-[var(--form-button)]" : undefined}
        />
        <span
          className={cn("text-sm", tf ? "text-[var(--form-answer)]" : "text-muted-foreground")}
        >
          {agree || "勾选"}
        </span>
      </div>
    );
  }

  if (column.type === "select") {
    const display =
      settings?.kind === "select" ? settings.display ?? "dropdown" : "dropdown";
    if (display === "buttons") {
      return (
        <ButtonGroup
          options={column.config?.options ?? []}
          value={typeof value === "string" ? value : null}
          onChange={onChange}
          multiple={false}
          typeform={tf}
        />
      );
    }
    return (
      <SelectControl
        options={column.config?.options ?? []}
        value={typeof value === "string" ? value : null}
        onChange={onChange}
        placeholder={placeholder}
        typeform={tf}
      />
    );
  }

  if (column.type === "multi_select") {
    const display =
      settings?.kind === "multi_select"
        ? settings.display ?? "checkbox"
        : "checkbox";
    if (display === "buttons") {
      return (
        <ButtonGroup
          options={column.config?.options ?? []}
          values={Array.isArray(value) ? value : []}
          onChange={onChange}
          multiple
          typeform={tf}
        />
      );
    }
    return (
      <MultiSelectControl
        options={column.config?.options ?? []}
        value={Array.isArray(value) ? value : []}
        onChange={onChange}
        placeholder={placeholder}
        typeform={tf}
      />
    );
  }

  if (column.type === "person") {
    return (
      <PersonControl
        members={members}
        value={typeof value === "string" ? value : null}
        onChange={onChange}
        placeholder={placeholder}
        typeform={tf}
      />
    );
  }

  if (column.type === "date") {
    return (
      <DatePicker
        value={typeof value === "string" ? value : null}
        dateFormat={column.config?.dateFormat ?? "YYYY-MM-DD"}
        onChange={(v) => onChange(v)}
      />
    );
  }

  if (column.type === "number") {
    const min = settings?.kind === "number" ? settings.min : undefined;
    const max = settings?.kind === "number" ? settings.max : undefined;
    const step = settings?.kind === "number" ? settings.step : undefined;
    return (
      <Input
        inputMode="decimal"
        className={cn(
          "tabular-nums",
          tf &&
            "h-12 border-0 border-b-2 border-[color-mix(in_srgb,var(--form-answer)_25%,transparent)] bg-transparent px-0 text-lg shadow-none focus-visible:border-[var(--form-accent)] focus-visible:ring-0"
        )}
        style={tf ? { color: "var(--form-answer)", borderRadius: 0 } : undefined}
        value={value === null || value === undefined ? "" : String(value)}
        placeholder={placeholder ?? "数字"}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") return onChange(null);
          const n = Number(v);
          onChange(Number.isNaN(n) ? null : n);
        }}
      />
    );
  }

  const textSettings = settings?.kind === "text" ? settings : undefined;
  const multiline =
    textSettings?.multiline ??
    Boolean((column.config as { multiline?: boolean } | undefined)?.multiline);
  const inputMode = textSettings?.inputMode ?? "text";
  const maxLength = textSettings?.maxLength;

  if (multiline) {
    return (
      <Textarea
        value={typeof value === "string" ? value : ""}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        rows={tf ? 3 : 4}
        className={cn(
          tf &&
            "min-h-[96px] border-0 border-b-2 border-[color-mix(in_srgb,var(--form-answer)_25%,transparent)] bg-transparent px-0 text-lg shadow-none focus-visible:border-[var(--form-accent)] focus-visible:ring-0"
        )}
        style={tf ? { color: "var(--form-answer)", borderRadius: 0 } : undefined}
      />
    );
  }

  return (
    <Input
      type={inputMode === "email" ? "email" : inputMode === "url" ? "url" : "text"}
      inputMode={inputMode === "email" ? "email" : inputMode === "url" ? "url" : "text"}
      value={typeof value === "string" ? value : value == null ? "" : String(value)}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        tf &&
          "h-12 border-0 border-b-2 border-[color-mix(in_srgb,var(--form-answer)_25%,transparent)] bg-transparent px-0 text-lg shadow-none focus-visible:border-[var(--form-accent)] focus-visible:ring-0"
      )}
      style={tf ? { color: "var(--form-answer)", borderRadius: 0 } : undefined}
    />
  );
}

function ButtonGroup({
  options,
  value,
  values,
  onChange,
  multiple,
  typeform,
}: {
  options: SelectOption[];
  value?: string | null;
  values?: string[];
  onChange: (v: CellValue) => void;
  multiple: boolean;
  typeform?: boolean;
}) {
  const selected = multiple ? values ?? [] : value ? [value] : [];
  const toggle = (id: string) => {
    if (multiple) {
      if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
      else onChange([...selected, id]);
    } else {
      onChange(id);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => toggle(o.id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm transition-colors",
              on
                ? typeform
                  ? "border-[var(--form-button)] bg-[var(--form-button)] text-[var(--form-button-text)]"
                  : "border-foreground bg-foreground text-background"
                : typeform
                  ? "border-[color-mix(in_srgb,var(--form-answer)_25%,transparent)] bg-transparent text-[var(--form-answer)] hover:border-[var(--form-accent)]"
                  : "border-border bg-background hover:bg-muted"
            )}
            style={typeform ? { borderRadius: "var(--form-radius)" } : undefined}
          >
            <SelectChip option={o} />
          </button>
        );
      })}
    </div>
  );
}

function SelectControl({
  options,
  value,
  onChange,
  placeholder,
  typeform,
}: {
  options: SelectOption[];
  value: string | null;
  onChange: (v: CellValue) => void;
  placeholder?: string;
  typeform?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-9 w-full justify-between font-normal",
            typeform &&
              "h-12 border-[color-mix(in_srgb,var(--form-answer)_25%,transparent)] bg-transparent text-[var(--form-answer)]"
          )}
          style={typeform ? { borderRadius: "var(--form-radius)" } : undefined}
        >
          {current ? (
            <SelectChip option={current} />
          ) : (
            <span className="opacity-60">{placeholder ?? "选择…"}</span>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1" align="start">
        <button
          type="button"
          className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          清空
        </button>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            onClick={() => {
              onChange(o.id);
              setOpen(false);
            }}
          >
            <SelectChip option={o} />
            {value === o.id && <Check className="h-3.5 w-3.5" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function MultiSelectControl({
  options,
  value,
  onChange,
  placeholder,
  typeform,
}: {
  options: SelectOption[];
  value: string[];
  onChange: (v: CellValue) => void;
  placeholder?: string;
  typeform?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.filter((o) => value.includes(o.id));
  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-auto min-h-9 w-full justify-between py-1.5 font-normal",
            typeform &&
              "min-h-12 border-[color-mix(in_srgb,var(--form-answer)_25%,transparent)] bg-transparent text-[var(--form-answer)]"
          )}
          style={typeform ? { borderRadius: "var(--form-radius)" } : undefined}
        >
          {selected.length ? (
            <div className="flex flex-wrap gap-1">
              {selected.map((o) => (
                <SelectChip key={o.id} option={o} />
              ))}
            </div>
          ) : (
            <span className="opacity-60">{placeholder ?? "选择多个…"}</span>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1" align="start">
        {options.map((o) => {
          const on = value.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
              onClick={() => toggle(o.id)}
            >
              <span
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded border",
                  on ? "border-foreground bg-foreground text-background" : "border-border"
                )}
              >
                {on && <Check className="h-3 w-3" />}
              </span>
              <SelectChip option={o} />
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function PersonControl({
  members,
  value,
  onChange,
  placeholder,
  typeform,
}: {
  members: MemberOption[];
  value: string | null;
  onChange: (v: CellValue) => void;
  placeholder?: string;
  typeform?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = members.find((m) => m.userId === value || m.name === value);
  const list = members.filter(
    (m) =>
      !q ||
      m.name.toLowerCase().includes(q.toLowerCase()) ||
      m.email.toLowerCase().includes(q.toLowerCase())
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-9 w-full justify-between font-normal",
            typeform &&
              "h-12 border-[color-mix(in_srgb,var(--form-answer)_25%,transparent)] bg-transparent text-[var(--form-answer)]"
          )}
          style={typeform ? { borderRadius: "var(--form-radius)" } : undefined}
        >
          {current ? (
            <span className="inline-flex items-center gap-1.5">
              {current.kind === "agent" ? (
                <Bot className="h-3.5 w-3.5 text-agent" />
              ) : (
                <User className="h-3.5 w-3.5 opacity-60" />
              )}
              {current.name}
            </span>
          ) : (
            <span className="opacity-60">{placeholder ?? "选择成员…"}</span>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1" align="start">
        <Input
          className="mb-1 h-8"
          placeholder="搜索…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="button"
          className="flex w-full rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          清空
        </button>
        {list.map((m) => (
          <button
            key={m.userId}
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            onClick={() => {
              onChange(m.userId);
              setOpen(false);
            }}
          >
            {m.kind === "agent" ? (
              <Bot className="h-3.5 w-3.5 text-agent" />
            ) : (
              <User className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="truncate">{m.name}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
