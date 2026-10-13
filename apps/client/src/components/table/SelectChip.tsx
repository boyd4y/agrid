import { X } from "lucide-react";
import { selectOptionStyle } from "@/lib/select-colors";
import type { SelectOption } from "@/types/table";
import { useTranslation } from "react-i18next";

/** Shared select/multi_select chip — same in cell, popover, and filters. */
export function SelectChip({
  option,
  onRemove,
  className,
}: {
  option: SelectOption;
  onRemove?: () => void;
  className?: string;
}) {
  const { t } = useTranslation("table");
  const style = selectOptionStyle(option.color);
  return (
    <span
      className={
        className ??
        "inline-flex h-[22px] max-w-full items-center gap-1 rounded-[3px] px-[6px] text-[12px] font-medium leading-none tracking-[-0.01em]"
      }
      style={{ background: style.background, color: style.color }}
    >
      <span className="truncate">{option.label}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={t("removeOption", { label: option.label })}
          className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm opacity-60 hover:bg-current/10 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
