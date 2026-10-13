import { useId, useRef, useState, type PointerEvent } from "react";
import { Check } from "lucide-react";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Field, FieldGroup, FieldLabel, FieldError } from "@tabdo/ui/components/field";
import { Popover, PopoverContent, PopoverTrigger } from "@tabdo/ui/components/popover";
import { cn } from "@tabdo/ui/lib/utils";
import { contrastColor, clampUnit, hexToHsv, hsvToHex, normalizeColorHex, type HsvColor } from "@tabdo/ui/lib/color";

const defaultLabels = {
  pickColor: "Pick color", colorPicker: "Color picker", colorPalette: "Palette",
  saturationBrightness: "Saturation and brightness", colorSaturation: "Saturation", colorBrightness: "Brightness",
  colorHue: "Hue", presetColors: "Presets", hexColor: "HEX", hexInvalid: "Enter a valid HEX color",
};
const defaultPresets = [
  ["#64748b", "Gray"], ["#3b82f6", "Blue"], ["#22c55e", "Green"], ["#facc15", "Yellow"], ["#f97316", "Orange"],
  ["#ef4444", "Red"], ["#8b5cf6", "Purple"], ["#ec4899", "Pink"], ["#a16207", "Brown"], ["#f1f1ef", "White"],
].map(([hex, label]) => ({ hex, label }));
type Props = { value: string; onChange: (color: string) => void; className?: string; label?: string;
  presets?: readonly { hex: string; label: string }[]; labels?: Partial<typeof defaultLabels> };
const colorStyle = (input: string) => { const background = normalizeColorHex(input) ?? "#ffffff"; return { background, color: contrastColor(background) }; };

/** Palette changes apply immediately; incomplete HEX input stays local. */
export function ColorPicker({ value, onChange, className, label, presets = defaultPresets, labels: suppliedLabels }: Props) {
  const labels = { ...defaultLabels, ...suppliedLabels };
  const resolvedLabel = label ?? labels.pickColor;
  const id = useId();
  const saturationInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [hsv, setHsv] = useState<HsvColor>({ h: 0, s: 0, v: 1 });
  const selected = colorStyle(value);
  const normalized = normalizeColorHex(draft);
  const preview = colorStyle(normalized ?? hsvToHex(hsv));
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
      <PopoverContent className="w-64 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-4" align="start" aria-label={labels.colorPicker} data-testid="color-picker">
        <FieldGroup className="gap-3">
          <Field className="gap-2">
            <FieldLabel>{labels.colorPalette}</FieldLabel>
            <div role="group" aria-label={labels.saturationBrightness}
              className="relative h-28 touch-none select-none rounded-md border border-input focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-popover"
              style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), ${hsvToHex({ h: hsv.h, s: 1, v: 1 })}` }}
              {...pointerHandlers(false)}>
              <input ref={saturationInput} type="range" min={0} max={100} step={1} value={Math.round(hsv.s * 100)}
                className="sr-only" aria-label={labels.colorSaturation}
                onChange={(event) => editHsv({ ...hsv, s: Number(event.target.value) / 100 })} />
              <input type="range" min={0} max={100} step={1} value={Math.round(hsv.v * 100)}
                className="sr-only" aria-label={labels.colorBrightness}
                onChange={(event) => editHsv({ ...hsv, v: Number(event.target.value) / 100 })} />
              <span aria-hidden="true" className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-sm"
                style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: preview.background, borderColor: preview.color }} />
            </div>
          </Field>
          <Field className="gap-2">
            <FieldLabel id={`${id}-hue-label`}>{labels.colorHue}</FieldLabel>
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
                style={{ left: `${hsv.h / 360 * 100}%`, background: hsvToHex({ h: hsv.h, s: 1, v: 1 }), borderColor: colorStyle(hsvToHex({ h: hsv.h, s: 1, v: 1 })).color }} />
            </div>
          </Field>
          <Field className="gap-2">
            <FieldLabel>{labels.presetColors}</FieldLabel>
            <div className="grid grid-cols-[repeat(5,1.5rem)] justify-between gap-y-1.5">
              {presets.map(({ label: presetLabel, hex }) => {
                const active = normalized === hex;
                return (
                  <Button key={hex} type="button" variant="outline" size="icon" className={cn("size-6 p-0.5", active && "ring-2 ring-ring ring-offset-2 ring-offset-popover")}
                    aria-label={presetLabel} aria-pressed={active} title={presetLabel} onClick={() => pickHex(hex.toUpperCase())}>
                    <span className="flex size-full items-center justify-center rounded-sm" style={{ background: hex, color: colorStyle(hex).color }}>{active && <Check data-icon="inline-start" />}</span>
                  </Button>
                );
              })}
            </div>
          </Field>
          <Field data-invalid={invalid} className="gap-2">
            <FieldLabel htmlFor={id}>{labels.hexColor}</FieldLabel>
            <Input id={id} value={draft} maxLength={7} spellCheck={false} autoComplete="off" aria-invalid={invalid} aria-describedby={invalid ? `${id}-hex-error` : undefined} placeholder="#3B82F6"
              onChange={(event) => pickHex(event.target.value)}
              onBlur={() => setInvalid(!normalizeColorHex(draft))}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); setInvalid(!normalizeColorHex(draft)); } }} />
            {invalid && <FieldError id={`${id}-hex-error`}>{labels.hexInvalid}</FieldError>}
          </Field>
        </FieldGroup>
      </PopoverContent>
    </Popover>
  );
}
