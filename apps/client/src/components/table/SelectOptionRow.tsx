import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SelectOption } from "@/types/table";
import { SelectChip } from "./SelectChip";

export const CELL_OPTION_CLASS =
  "flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-1 focus-visible:ring-primary";

/** Shared option presentation, with each host retaining its existing visual treatment. */
export function SelectOptionRow({
  option,
  selected,
  onSelect,
  surface,
  multiple = false,
}: {
  option: SelectOption;
  selected: boolean;
  onSelect: () => void;
  surface: "cell" | "form";
  multiple?: boolean;
}) {
  const cell = surface === "cell";
  return (
    <button
      type="button"
      data-cell-option={cell ? true : undefined}
      aria-pressed={cell ? selected : undefined}
      className={cn(
        cell
          ? CELL_OPTION_CLASS
          : multiple
            ? "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            : "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted",
        cell && selected && "bg-accent",
      )}
      onClick={onSelect}
    >
      {multiple && (
        <span
          className={cn(
            cell
              ? "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border"
              : "flex h-4 w-4 items-center justify-center rounded border",
            selected
              ? "border-foreground bg-foreground text-background"
              : cell
                ? "border-border bg-transparent"
                : "border-border",
          )}
          aria-hidden={cell ? true : undefined}
        >
          {selected && <Check className={cell ? "h-2.5 w-2.5" : "h-3 w-3"} />}
        </span>
      )}
      <SelectChip option={option} />
      {!multiple && selected && (
        <Check className={cell ? "ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" : "h-3.5 w-3.5"} />
      )}
    </button>
  );
}
