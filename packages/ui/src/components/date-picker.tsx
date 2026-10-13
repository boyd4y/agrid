import { useEffect, useState } from "react";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { Button } from "@tabdo/ui/components/button";
import { Calendar } from "@tabdo/ui/components/calendar";
import { Input } from "@tabdo/ui/components/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@tabdo/ui/components/popover";
import { cn } from "@tabdo/ui/lib/utils";
import {
  formatDateDisplay,
  parseDateValue,
  toStorageDate,
} from "@tabdo/ui/lib/date-format";
import type { DateFormat } from "@tabdo/ui/lib/date-format";
import type { Locale } from "date-fns";

const defaultLabels = { pickDate: "Pick date", clear: "Clear", empty: "Empty" };

type Props = {
  labels?: Partial<typeof defaultLabels>;
  locale?: Locale;
  value: string | null;
  onChange: (value: string | null) => void;
  onCancel?: () => void;
  dateFormat?: DateFormat;
  /** When true, open immediately (cell edit mode) */
  autoOpen?: boolean;
  /** Cell-embedded: no trigger button, anchor to parent */
  embedded?: boolean;
  className?: string;
  placeholder?: string;
  size?: "default" | "sm";
};

/**
 * shadcn Popover date picker: calendar + manual text input.
 * Storage is always YYYY-MM-DD; display uses dateFormat.
 */
export function DatePicker({
  value,
  onChange,
  onCancel,
  dateFormat = "YYYY-MM-DD",
  autoOpen = false,
  embedded = false,
  className,
  placeholder,
  size = "sm",
  labels: suppliedLabels,
  locale,
}: Props) {
  const labels = { ...defaultLabels, ...suppliedLabels };
  const [open, setOpen] = useState(autoOpen);
  const [draft, setDraft] = useState(
    value ? formatDateDisplay(value, dateFormat) : ""
  );
  const selected = parseDateValue(value);

  useEffect(() => {
    setDraft(value ? formatDateDisplay(value, dateFormat) : "");
  }, [value, dateFormat]);

  const commitText = () => {
    const trimmed = draft.trim();
    if (trimmed === (value ? formatDateDisplay(value, dateFormat) : "")) return;
    if (!trimmed) {
      onChange(null);
      return;
    }
    const d = parseDateValue(trimmed);
    if (d) {
      onChange(toStorageDate(d));
      setDraft(formatDateDisplay(toStorageDate(d), dateFormat));
    } else {
      // keep previous stored value; reset draft to formatted
      setDraft(value ? formatDateDisplay(value, dateFormat) : "");
    }
  };

  const content = (
    <PopoverContent
      align="start"
      alignOffset={embedded ? -8 : 0}
      side="bottom"
      sideOffset={6}
      className="w-auto p-2"
      aria-label={labels.pickDate}
      onOpenAutoFocus={(e) => {
        if (embedded) e.preventDefault();
      }}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <Input
          size="sm"
          className="h-8 flex-1"
          placeholder={placeholder ?? dateFormat}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitText();
              setOpen(false);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              onCancel?.();
            }
          }}
          autoFocus={embedded}
        />
        {value && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={() => {
              setDraft("");
              onChange(null);
            }}
            title={labels.clear}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <Calendar
        locale={locale}
        mode="single"
        selected={selected}
        onSelect={(d) => {
          if (!d) {
            onChange(null);
            setDraft("");
            return;
          }
          const stored = toStorageDate(d);
          onChange(stored);
          setDraft(formatDateDisplay(stored, dateFormat));
          setOpen(false);
        }}
        defaultMonth={selected}
      />
    </PopoverContent>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onCancel?.();
      }}
    >
      {embedded ? (
        <>
          <PopoverAnchor asChild>
            <div className={cn("flex h-full w-full items-center", className)}>
              {value ? (
                <span className="truncate text-[13px] text-foreground">
                  {formatDateDisplay(value, dateFormat)}
                </span>
              ) : (
                <span className="text-muted-foreground">{labels.empty}</span>
              )}
            </div>
          </PopoverAnchor>
          {content}
        </>
      ) : (
        <>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size={size}
              className={cn(
                "min-w-0 justify-start gap-2 font-normal",
                !value && "text-muted-foreground",
                className
              )}
            >
              <CalendarIcon className="h-3.5 w-3.5 opacity-60" />
              <span className="min-w-0 truncate">{value ? formatDateDisplay(value, dateFormat) : placeholder ?? labels.pickDate}</span>
            </Button>
          </PopoverTrigger>
          {content}
        </>
      )}
    </Popover>
  );
}
