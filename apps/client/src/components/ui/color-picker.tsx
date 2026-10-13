import { useId, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldError, FieldDescription } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { SELECT_COLORS, SELECT_COLOR_NAMES, SELECT_COLOR_PRESETS, normalizeColorHex, selectOptionStyle, type SelectColorToken } from "@/lib/select-colors";
import { useTranslation } from "react-i18next";

type Props = { value: string; onChange: (color: string) => void; className?: string; label?: string };

/** Presets and HEX input; values stay in the parent draft until its form is saved. */
export function ColorPicker({ value, onChange, className, label }: Props) {
  const { t } = useTranslation("common");
  const resolvedLabel = label ?? t("pickColor");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const selected = selectOptionStyle(value);
  const normalized = normalizeColorHex(draft);
  const preview = normalized ? selectOptionStyle(normalized) : selected;
  const apply = () => {
    if (!normalized) { setInvalid(true); return; }
    onChange(normalized); setOpen(false);
  };
  return <Popover open={open} onOpenChange={(next) => {
    setOpen(next); if (next) { setDraft(selected.background.toUpperCase()); setInvalid(false); }
  }}>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" size="icon" className={cn("size-8 shrink-0 p-1", className)} aria-label={resolvedLabel}>
        <span className="size-full rounded-sm border border-foreground/10" style={{ background: selected.background }} />
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-64 p-4" align="start" aria-label={t("colorPicker")} data-testid="color-picker">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t("presetColors")}</p>
          <div className="grid grid-cols-5 gap-2">
            {SELECT_COLOR_PRESETS.map((color) => {
              const token = (Object.keys(SELECT_COLORS) as SelectColorToken[]).find((name) => SELECT_COLORS[name].background === color)!;
              const active = selected.background === color;
              return <Button key={color} type="button" variant="outline" size="icon" className={cn("size-8 p-1", active && "ring-2 ring-ring ring-offset-2 ring-offset-popover")}
                aria-label={SELECT_COLOR_NAMES[token]} aria-pressed={active} title={SELECT_COLOR_NAMES[token]} onClick={() => { onChange(color); setOpen(false); }}>
                <span className="flex size-full items-center justify-center rounded-sm" style={{ background: color, color: selectOptionStyle(color).color }}>{active && <Check data-icon="inline-start" />}</span>
              </Button>;
            })}
          </div>
        </div>
        <FieldGroup className="gap-2">
          <Field data-invalid={invalid} className="gap-2">
            <FieldLabel htmlFor={id}>{t("hexColor")}</FieldLabel>
            <Input id={id} value={draft} maxLength={7} spellCheck={false} aria-invalid={invalid} placeholder="#D3E5EF" onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); apply(); } }} />
            {invalid ? <FieldError>{t("hexInvalid")}</FieldError> : <FieldDescription>{t("hexHint")}</FieldDescription>}
          </Field>
        </FieldGroup>
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-md px-2 py-1 text-xs" style={{ background: preview.background, color: preview.color }}>{t("colorPreview")}</span>
          <Button type="button" size="sm" onClick={apply}><Check data-icon="inline-start" />{t("apply")}</Button>
        </div>
      </div>
    </PopoverContent>
  </Popover>;
}
