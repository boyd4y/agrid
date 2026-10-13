import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Table2 } from "lucide-react";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Popover, PopoverTrigger, PopoverContent } from "@tabdo/ui/components/popover";
import { DropdownMenuItem } from "@tabdo/ui/components/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@tabdo/ui/components/toggle-group";
import { Field, FieldError } from "@tabdo/ui/components/field";
import { TABLE_ICONS, TABLE_ICON_CATEGORIES, type TableIconCategory } from "@/lib/table-icons";
import { cn } from "@/lib/utils";

export function TableIcon({ name, className }: { name?: string | null; className?: string }) {
  const Icon = TABLE_ICONS.find((entry) => entry.name === name)?.icon ?? Table2;
  return <Icon className={className} />;
}

export function TableIconPicker({ value, onChange, expanded = false, menuItem = false }: { value?: string | null; onChange: (icon: string | null) => Promise<void>; expanded?: boolean; menuItem?: boolean }) {
  const { t, i18n } = useTranslation(["table", "icons"]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<TableIconCategory | "all">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = search.trim().toLocaleLowerCase();
  const icons = TABLE_ICONS.filter((entry) => {
    if (category !== "all" && entry.category !== category) return false;
    return [entry.name, i18n.getFixedT("en", "icons")(`names.${entry.name}`), i18n.getFixedT("zh-CN", "icons")(`names.${entry.name}`)]
      .some((title) => title.toLocaleLowerCase().includes(query));
  });
  const select = async (icon: string | null) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await onChange(icon); setOpen(false); }
    catch (error) { setError(error instanceof Error ? error.message : t("saveIconFailed")); }
    finally { setBusy(false); }
  };
  return (
    <Popover open={open} onOpenChange={(next) => {
      if (!busy) { setOpen(next); setSearch(""); setCategory("all"); setError(null); }
    }}>
      <PopoverTrigger asChild>
        {menuItem ? (
          <DropdownMenuItem onSelect={(event) => event.preventDefault()}><TableIcon name={value} />{t("changeTableIcon")}</DropdownMenuItem>
        ) : (
          <Button type="button" variant="ghost" size={expanded ? "sm" : "icon"} className={cn("shrink-0", expanded && "w-full justify-start px-2 text-sm font-normal")}
            aria-label={t("changeTableIcon")} title={t("changeTableIcon")}>
            <TableIcon name={value} />{expanded && t("changeIcon")}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="flex w-96 max-h-[var(--radix-popover-content-available-height)] flex-col gap-2 p-3" align="start" aria-label={t("selectTableIcon")}>
        <Field className="shrink-0">
          <Input size="sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("icons:search")} aria-label={t("icons:search")} />
        </Field>
        <div className="flex min-h-0 gap-2">
          <div className="w-20 shrink-0 overflow-y-auto overscroll-contain p-1">
            <ToggleGroup type="single" orientation="vertical" size="sm" value={category} aria-label={t("icons:categoriesLabel")}
              className="flex-col items-stretch justify-start gap-0.5" onValueChange={(next) => { if (next) setCategory(next as TableIconCategory | "all"); }}>
              <ToggleGroupItem value="all" className="justify-start px-2">{t("icons:all")}</ToggleGroupItem>
              {TABLE_ICON_CATEGORIES.map((name) => <ToggleGroupItem key={name} value={name} className="justify-start px-2">{t(`icons:categories.${name}`)}</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
          <div key={`${category}:${query}`} className="max-h-72 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-1" data-testid="table-icon-grid-scroll">
            {icons.length ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(2rem,1fr))] gap-1 pb-1">
                {icons.map(({ name, icon: Icon }) => {
                  const label = t(`icons:names.${name}`);
                  return <Button key={name} type="button" variant={value === name ? "secondary" : "ghost"} size="icon" disabled={busy}
                    aria-label={label} title={`${label} · ${name}`} aria-pressed={value === name} className="size-8 w-full" onClick={() => void select(name)}><Icon /></Button>;
                })}
              </div>
            ) : <p role="status" className="px-1 py-4 text-center text-sm text-muted-foreground">{t("icons:noResults")}</p>}
          </div>
        </div>
        <Button type="button" variant="ghost" size="sm" className="shrink-0" disabled={busy} onClick={() => void select(null)}>{t("resetDefaultIcon")}</Button>
        {error && <FieldError>{error}</FieldError>}
      </PopoverContent>
    </Popover>
  );
}
