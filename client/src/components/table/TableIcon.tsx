import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Table2, Database, Folder, BriefcaseBusiness, Users, UserRound, Contact, Building2, ShoppingCart, Package, Truck, CalendarDays, CheckSquare, ListTodo, Kanban, ChartNoAxesCombined, ChartPie, Wallet, CreditCard, Receipt, FileText, Files, BookOpen, GraduationCap, Lightbulb, Rocket, Target, Flag, Heart, Star, Globe, MapPin, Plane, Coffee, Code, Cpu, Palette, Music, Camera, Megaphone, Search, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const ICON_DEFS: { name: string; icon: LucideIcon }[] = [
  { name: "Table2", icon: Table2 },
  { name: "Database", icon: Database },
  { name: "Folder", icon: Folder },
  { name: "BriefcaseBusiness", icon: BriefcaseBusiness },
  { name: "Users", icon: Users },
  { name: "UserRound", icon: UserRound },
  { name: "Contact", icon: Contact },
  { name: "Building2", icon: Building2 },
  { name: "ShoppingCart", icon: ShoppingCart },
  { name: "Package", icon: Package },
  { name: "Truck", icon: Truck },
  { name: "CalendarDays", icon: CalendarDays },
  { name: "CheckSquare", icon: CheckSquare },
  { name: "ListTodo", icon: ListTodo },
  { name: "Kanban", icon: Kanban },
  { name: "ChartNoAxesCombined", icon: ChartNoAxesCombined },
  { name: "ChartPie", icon: ChartPie },
  { name: "Wallet", icon: Wallet },
  { name: "CreditCard", icon: CreditCard },
  { name: "Receipt", icon: Receipt },
  { name: "FileText", icon: FileText },
  { name: "Files", icon: Files },
  { name: "BookOpen", icon: BookOpen },
  { name: "GraduationCap", icon: GraduationCap },
  { name: "Lightbulb", icon: Lightbulb },
  { name: "Rocket", icon: Rocket },
  { name: "Target", icon: Target },
  { name: "Flag", icon: Flag },
  { name: "Heart", icon: Heart },
  { name: "Star", icon: Star },
  { name: "Globe", icon: Globe },
  { name: "MapPin", icon: MapPin },
  { name: "Plane", icon: Plane },
  { name: "Coffee", icon: Coffee },
  { name: "Code", icon: Code },
  { name: "Cpu", icon: Cpu },
  { name: "Palette", icon: Palette },
  { name: "Music", icon: Music },
  { name: "Camera", icon: Camera },
  { name: "Megaphone", icon: Megaphone },
];

export function TableIcon({ name, className }: { name?: string | null; className?: string }) {
  const Icon = ICON_DEFS.find((entry) => entry.name === name)?.icon ?? Table2;
  return <Icon className={className} />;
}

export function TableIconPicker({ value, onChange, expanded = false, menuItem = false }: { value?: string | null; onChange: (icon: string | null) => Promise<void>; expanded?: boolean; menuItem?: boolean }) {
  const { t } = useTranslation("table");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const icons = ICON_DEFS.map((entry) => ({
    ...entry,
    label: t(`icons.${entry.name}`),
  }));
  const select = async (icon: string | null) => {
    setBusy(true); setError(null);
    try { await onChange(icon); setOpen(false); }
    catch (error) { setError(error instanceof Error ? error.message : t("saveIconFailed")); }
    finally { setBusy(false); }
  };
  return <Popover open={open} onOpenChange={(next) => { if (!busy) { setOpen(next); setSearch(""); setError(null); } }}>
    <PopoverTrigger asChild>{menuItem ? <DropdownMenuItem onSelect={(event) => event.preventDefault()}><TableIcon name={value} />{t("changeTableIcon")}</DropdownMenuItem> : <Button variant="ghost" size={expanded ? "sm" : "icon"} className={cn("shrink-0", expanded && "w-full justify-start px-2 text-sm font-normal")} aria-label={t("changeTableIcon")} title={t("changeTableIcon")}><TableIcon name={value} className={expanded ? "size-3.5" : "size-5"} />{expanded && t("changeIcon")}</Button>}</PopoverTrigger>
    <PopoverContent className="w-72 p-3" align="start" aria-label={t("selectTableIcon")}>
      <div className="relative mb-2"><Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchIcons")} aria-label={t("searchIcons")} className="h-8 pl-8" /></div>
      <div className="grid max-h-64 grid-cols-6 gap-1 overflow-y-auto">
        {icons.filter(({ name, label }) => (name + label).toLowerCase().includes(search.toLowerCase())).map(({ name, label, icon: Icon }) => <Button key={name} variant="ghost" size="icon" disabled={busy} aria-label={label} title={`${label} · ${name}`} aria-pressed={value === name} className={cn("size-9", value === name && "bg-accent ring-1 ring-primary")} onClick={() => void select(name)}><Icon className="size-4" /></Button>)}
      </div>
      <Button variant="ghost" size="sm" className="mt-2 w-full" disabled={busy} onClick={() => void select(null)}>{t("resetDefaultIcon")}</Button>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </PopoverContent>
  </Popover>;
}
