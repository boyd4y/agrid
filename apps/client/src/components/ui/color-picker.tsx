import { useId, useRef, useState, type PointerEvent } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldError } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { SELECT_COLOR_NAMES, SELECT_COLOR_PALETTE, selectOptionStyle } from "@/lib/select-colors";
import { clampUnit, hexToHsv, hsvToHex, normalizeColorHex, type HsvColor } from "@/lib/color";
import { useTranslation } from "react-i18next";

type Props = { value: string; onChange: (color: string) => void; className?: string; label?: string };

/** Palette changes apply immediately; incomplete HEX input stays local. */
export function ColorPicker({ value, onChange, className, label }: Props) {
  const { t } = useTranslation("common");
  const resolvedLabel = label ?? t("pickColor");
  const id = useId();
  const saturationInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [hsv, setHsv] = useState<HsvColor>({ h: 0, s: 0, v: 1 });
  const selected = selectOptionStyle(value);
  const normalized = normalizeColorHex(draft);
  const preview = selectOptionStyle(normalized ?? hsvToHex(hsv));
  const editHsv = (next: HsvColor) => {
    setHsv(next);
    const hex = hsvToHex(next);
    setDraft(hex.toUpperCase());
    onChange(hex);
    setInvalid(false);
  };
  const pickHex = (hex: string) => {
    const next = hexToHsv(hex);
    if (next) {
      // Grays retain the selected hue so adding saturation feels natural.
      setHsv({ ...next, h: next.s === 0 ? hsv.h : next.h });
      onChange(normalizeColorHex(hex)!);
    }
    setDraft(hex);
    setInvalid(false);
  };
  const pointerColor = (event: PointerEvent<HTMLDivElement>, hueOnly: boolean) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = clampUnit((event.clientX - rect.left) / rect.width);
    editHsv(hueOnly ? { ...hsv, h: x * 360 } : { ...hsv, s: x, v: 1 - clampUnit((event.clientY - rect.top) / rect.height) });
  };
  const pointerHandlers = (hueOnly: boolean) => ({
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      if (hueOnly) event.currentTarget.focus({ preventScroll: true });
      else saturationInput.current?.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerColor(event, hueOnly);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) pointerColor(event, hueOnly);
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    },
  });
  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next);
      if (next) {
        setDraft(selected.background.toUpperCase());
        setHsv(hexToHsv(selected.background)!);
        setInvalid(false);
      }
    }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="icon" className={cn("size-8 shrink-0 p-1", className)} aria-label={resolvedLabel}>
          <span className="size-full rounded-sm border border-foreground/10" style={{ background: selected.background }} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-4" align="start" aria-label={t("colorPicker")} data-testid="color-picker">
        <FieldGroup className="gap-3">
          <Field className="gap-2">
            <FieldLabel>{t("colorPalette")}</FieldLabel>
            <div role="group" aria-label={t("saturationBrightness")}
              className="relative h-28 touch-none select-none rounded-md border border-input focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-popover"
              style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), ${hsvToHex({ h: hsv.h, s: 1, v: 1 })}` }}
              {...pointerHandlers(false)}>
              <input ref={saturationInput} type="range" min={0} max={100} step={1} value={Math.round(hsv.s * 100)}
                className="sr-only" aria-label={t("colorSaturation")}
                onChange={(event) => editHsv({ ...hsv, s: Number(event.target.value) / 100 })} />
              <input type="range" min={0} max={100} step={1} value={Math.round(hsv.v * 100)}
                className="sr-only" aria-label={t("colorBrightness")}
                onChange={(event) => editHsv({ ...hsv, v: Number(event.target.value) / 100 })} />
              <span aria-hidden="true" className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-sm"
                style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: preview.background, borderColor: preview.color }} />
            </div>
          </Field>
          <Field className="gap-2">
            <FieldLabel id={`${id}-hue-label`}>{t("colorHue")}</FieldLabel>
            <div role="slider" tabIndex={0} aria-labelledby={`${id}-hue-label`} aria-valuemin={0} aria-valuemax={360}
              aria-valuenow={Math.round(hsv.h)} aria-orientation="horizontal"
              className="relative h-4 touch-none select-none rounded-full border border-input outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
              style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
              {...pointerHandlers(true)}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 10 : 1;
                const next = event.key === "Home" ? 0 : event.key === "End" ? 360
                  : ["ArrowRight", "ArrowUp", "PageUp"].includes(event.key) ? Math.min(360, hsv.h + (event.key === "PageUp" ? 10 : step))
                  : ["ArrowLeft", "ArrowDown", "PageDown"].includes(event.key) ? Math.max(0, hsv.h - (event.key === "PageDown" ? 10 : step)) : null;
                if (next !== null) { event.preventDefault(); event.stopPropagation(); editHsv({ ...hsv, h: next }); }
              }}>
              <span aria-hidden="true" className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-sm"
                style={{ left: `${hsv.h / 360 * 100}%`, background: hsvToHex({ h: hsv.h, s: 1, v: 1 }), borderColor: selectOptionStyle(hsvToHex({ h: hsv.h, s: 1, v: 1 })).color }} />
            </div>
          </Field>
          <Field className="gap-2">
            <FieldLabel>{t("presetColors")}</FieldLabel>
            <div className="grid grid-cols-[repeat(5,1.5rem)] justify-between gap-y-1.5">
              {SELECT_COLOR_PALETTE.map(({ token, hex }) => {
                const active = normalized === hex;
                return (
                  <Button key={token} type="button" variant="outline" size="icon" className={cn("size-6 p-0.5", active && "ring-2 ring-ring ring-offset-2 ring-offset-popover")}
                    aria-label={SELECT_COLOR_NAMES[token]} aria-pressed={active} title={SELECT_COLOR_NAMES[token]} onClick={() => pickHex(hex.toUpperCase())}>
                    <span className="flex size-full items-center justify-center rounded-sm" style={{ background: hex, color: selectOptionStyle(hex).color }}>{active && <Check data-icon="inline-start" />}</span>
                  </Button>
                );
              })}
            </div>
          </Field>
          <Field data-invalid={invalid} className="gap-2">
            <FieldLabel htmlFor={id}>{t("hexColor")}</FieldLabel>
            <Input id={id} value={draft} maxLength={7} spellCheck={false} autoComplete="off" aria-invalid={invalid} aria-describedby={invalid ? `${id}-hex-error` : undefined} placeholder="#3B82F6"
              onChange={(event) => pickHex(event.target.value)}
              onBlur={() => setInvalid(!normalizeColorHex(draft))}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); setInvalid(!normalizeColorHex(draft)); } }} />
            {invalid && <FieldError id={`${id}-hex-error`}>{t("hexInvalid")}</FieldError>}
          </Field>
        </FieldGroup>
      </PopoverContent>
    </Popover>
  );
}
