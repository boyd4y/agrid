import { useState } from "react";
import { Table2, Database, Folder, BriefcaseBusiness, Users, UserRound, Contact, Building2, ShoppingCart, Package, Truck, CalendarDays, CheckSquare, ListTodo, Kanban, ChartNoAxesCombined, ChartPie, Wallet, CreditCard, Receipt, FileText, Files, BookOpen, GraduationCap, Lightbulb, Rocket, Target, Flag, Heart, Star, Globe, MapPin, Plane, Coffee, Code, Cpu, Palette, Music, Camera, Megaphone, Search, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const ICONS: { name: string; label: string; icon: LucideIcon }[] = [
  { name: "Table2", label: "表格", icon: Table2 },
  { name: "Database", label: "数据库", icon: Database },
  { name: "Folder", label: "文件夹", icon: Folder },
  { name: "BriefcaseBusiness", label: "项目", icon: BriefcaseBusiness },
  { name: "Users", label: "团队", icon: Users },
  { name: "UserRound", label: "用户", icon: UserRound },
  { name: "Contact", label: "客户", icon: Contact },
  { name: "Building2", label: "公司", icon: Building2 },
  { name: "ShoppingCart", label: "销售", icon: ShoppingCart },
  { name: "Package", label: "库存", icon: Package },
  { name: "Truck", label: "物流", icon: Truck },
  { name: "CalendarDays", label: "日历", icon: CalendarDays },
  { name: "CheckSquare", label: "任务", icon: CheckSquare },
  { name: "ListTodo", label: "清单", icon: ListTodo },
  { name: "Kanban", label: "看板", icon: Kanban },
  { name: "ChartNoAxesCombined", label: "趋势", icon: ChartNoAxesCombined },
  { name: "ChartPie", label: "报表", icon: ChartPie },
  { name: "Wallet", label: "预算", icon: Wallet },
  { name: "CreditCard", label: "付款", icon: CreditCard },
  { name: "Receipt", label: "账单", icon: Receipt },
  { name: "FileText", label: "文档", icon: FileText },
  { name: "Files", label: "文件", icon: Files },
  { name: "BookOpen", label: "知识库", icon: BookOpen },
  { name: "GraduationCap", label: "课程", icon: GraduationCap },
  { name: "Lightbulb", label: "灵感", icon: Lightbulb },
  { name: "Rocket", label: "产品", icon: Rocket },
  { name: "Target", label: "目标", icon: Target },
  { name: "Flag", label: "里程碑", icon: Flag },
  { name: "Heart", label: "健康", icon: Heart },
  { name: "Star", label: "收藏", icon: Star },
  { name: "Globe", label: "全球", icon: Globe },
  { name: "MapPin", label: "地点", icon: MapPin },
  { name: "Plane", label: "旅行", icon: Plane },
  { name: "Coffee", label: "生活", icon: Coffee },
  { name: "Code", label: "代码", icon: Code },
  { name: "Cpu", label: "设备", icon: Cpu },
  { name: "Palette", label: "设计", icon: Palette },
  { name: "Music", label: "音乐", icon: Music },
  { name: "Camera", label: "摄影", icon: Camera },
  { name: "Megaphone", label: "营销", icon: Megaphone },
];

export function TableIcon({ name, className }: { name?: string | null; className?: string }) {
  const Icon = ICONS.find((entry) => entry.name === name)?.icon ?? Table2;
  return <Icon className={className} />;
}

export function TableIconPicker({ value, onChange, expanded = false, menuItem = false }: { value?: string | null; onChange: (icon: string | null) => Promise<void>; expanded?: boolean; menuItem?: boolean }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const select = async (icon: string | null) => {
    setBusy(true); setError(null);
    try { await onChange(icon); setOpen(false); }
    catch (error) { setError(error instanceof Error ? error.message : "保存图标失败"); }
    finally { setBusy(false); }
  };
  return <Popover open={open} onOpenChange={(next) => { if (!busy) { setOpen(next); setSearch(""); setError(null); } }}>
    <PopoverTrigger asChild>{menuItem ? <DropdownMenuItem onSelect={(event) => event.preventDefault()}><TableIcon name={value} />更改表格图标</DropdownMenuItem> : <Button variant="ghost" size={expanded ? "sm" : "icon"} className={cn("shrink-0", expanded && "w-full justify-start px-2 text-sm font-normal")} aria-label="更改表格图标" title="更改表格图标"><TableIcon name={value} className={expanded ? "size-3.5" : "size-5"} />{expanded && "更改图标"}</Button>}</PopoverTrigger>
    <PopoverContent className="w-72 p-3" align="start" aria-label="选择表格图标">
      <div className="relative mb-2"><Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索图标" aria-label="搜索图标" className="h-8 pl-8" /></div>
      <div className="grid max-h-64 grid-cols-6 gap-1 overflow-y-auto">
        {ICONS.filter(({ name, label }) => (name + label).toLowerCase().includes(search.toLowerCase())).map(({ name, label, icon: Icon }) => <Button key={name} variant="ghost" size="icon" disabled={busy} aria-label={label} title={`${label} · ${name}`} aria-pressed={value === name} className={cn("size-9", value === name && "bg-accent ring-1 ring-primary")} onClick={() => void select(name)}><Icon className="size-4" /></Button>)}
      </div>
      <Button variant="ghost" size="sm" className="mt-2 w-full" disabled={busy} onClick={() => void select(null)}>恢复默认图标</Button>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </PopoverContent>
  </Popover>;
}
