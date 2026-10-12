import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { SELECT_COLOR_PRESETS, selectOptionStyle, selectOptionSwatch } from "@/lib/select-colors";

type Props = {
  value: string;
  onChange: (color: string) => void;
  className?: string;
};

export function ColorPicker({ value, onChange, className }: Props) {
  const swatch = selectOptionSwatch(value);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "h-7 w-7 shrink-0 rounded-md border border-border shadow-sm",
            className
          )}
          style={{ background: swatch }}
          aria-label="选择颜色"
        />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="grid grid-cols-5 gap-1.5">
          {SELECT_COLOR_PRESETS.map((c) => {
            const s = selectOptionStyle(c);
            return (
              <button
                key={c}
                type="button"
                className={cn(
                  "h-6 w-6 rounded-md border border-black/10",
                  value === c && "ring-1 ring-[rgba(55,53,47,0.25)] ring-offset-1"
                )}
                style={{ background: s.background }}
                onClick={() => onChange(c)}
                title={c}
              />
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
