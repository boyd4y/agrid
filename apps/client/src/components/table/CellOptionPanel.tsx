import type { KeyboardEvent, ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@tabdo/ui/components/input";
import { PopoverContent } from "@tabdo/ui/components/popover";
import i18n from "@/i18n";

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
        aria-label={i18n.t("table:clearSelected")}
        title={i18n.t("table:clearSelected")}
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

/** Cell-only presentation; the editor owns filtering, draft state and closing. */
export function CellOptionPanel<T>({
  label,
  search,
  items,
  renderOption,
  emptyState,
  beforeList,
  afterList,
  onKeyDown,
}: {
  label: string;
  search: Parameters<typeof CellOptionSearch>[0];
  items: T[];
  renderOption: (item: T) => ReactNode;
  emptyState?: ReactNode;
  beforeList?: ReactNode;
  afterList?: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <PopoverContent
      align="start"
      alignOffset={-8}
      side="bottom"
      sideOffset={6}
      className="w-64 p-1"
      aria-label={label}
      onOpenAutoFocus={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        navigateOptions(e);
        onKeyDown?.(e);
      }}
    >
      <CellOptionSearch {...search} />
      {beforeList}
      <div className="max-h-56 overflow-y-auto">
        {items.length === 0 && emptyState}
        {items.map(renderOption)}
      </div>
      {afterList}
    </PopoverContent>
  );
}
