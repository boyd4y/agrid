import { ChevronDown, FileInput, Plus, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuGroup } from "@/components/ui/dropdown-menu";
import { TableIcon } from "@/components/table/TableIcon";
import { APP_NAVIGATION } from "@/components/shell/app-navigation";
import { getPreviewSlotRenderer, registerPreviewSlot, type PreviewSlotContext, type PreviewSlotKind, type PreviewTab } from "./preview-slot";
import { TablePreviewContent } from "./TablePreviewContent";
import { FormPreviewContent } from "./FormPreviewContent";
import { AutomationPreviewContent } from "./AutomationPreviewContent";

registerPreviewSlot("table", (ctx) => <TablePreviewContent {...ctx} />);
registerPreviewSlot("form", (ctx) => <FormPreviewContent {...ctx} />);
registerPreviewSlot("automations", (ctx) => <AutomationPreviewContent {...ctx} />);
const TYPES = [
  { kind: "table", label: "表格", icon: APP_NAVIGATION.tables.icon },
  { kind: "form", label: "表单", icon: FileInput },
  { kind: "automations", label: "自动化", icon: APP_NAVIGATION.automations.icon },
];
type Props = {
  tabs: PreviewTab[];
  activeKind: PreviewSlotKind | null;
  contexts: Record<string, PreviewSlotContext>;
  tables: { id: string; name: string; icon?: string | null }[];
  onOpenTab: (tab: PreviewTab) => void;
  onCloseTab: (kind: PreviewSlotKind) => void;
  onSelectTab: (kind: PreviewSlotKind) => void;
  onCreateTable: () => void;
};

export function PreviewSlot({ tabs, activeKind, contexts, tables, onOpenTab, onCloseTab, onSelectTab, onCreateTable }: Props) {
  return <section className="flex h-full min-h-0 min-w-0 flex-col bg-background" data-testid="workspace-preview-slot">
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
      {TYPES.map(({ kind, label, icon: Icon }) => <DropdownMenu key={kind}>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-8 px-2 text-xs" aria-label={`打开${label}`}><Icon className="size-3.5" />{label}<ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{kind === "table" ? "选择表格" : `选择表格的${label}`}</DropdownMenuLabel>
          <DropdownMenuGroup>{tables.map((table) => <DropdownMenuItem key={table.id} onSelect={() => onOpenTab({ kind, tableId: table.id })}><TableIcon name={table.icon} className="size-4 shrink-0" />{table.name}</DropdownMenuItem>)}
          {!tables.length && <DropdownMenuItem disabled>还没有表格</DropdownMenuItem>}</DropdownMenuGroup>
          {kind === "table" && <><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuItem onSelect={onCreateTable}><Plus className="size-3.5" />新建表格</DropdownMenuItem></DropdownMenuGroup></>}
        </DropdownMenuContent>
      </DropdownMenu>)}
      {activeKind && <Button variant="ghost" size="icon" className="ml-auto size-8 shrink-0" aria-label="刷新工作面板" title="刷新工作面板" onClick={() => contexts[activeKind]?.onRefresh()}><RefreshCw className="size-3.5" /></Button>}
    </div>
    {!tabs.length ? <p className="p-4 text-sm text-muted-foreground">从上方菜单打开表格、表单或自动化。</p> :
      <Tabs value={activeKind ?? ""} onValueChange={onSelectTab} className="min-h-0 flex-1 gap-0">
        <TabsList aria-label="已打开的工作内容" className="h-10 w-full shrink-0 justify-start overflow-x-auto rounded-none border-b border-border bg-transparent p-0">
          {tabs.map((tab) => {
            const type = TYPES.find((type) => type.kind === tab.kind);
            const table = tables.find((table) => table.id === tab.tableId);
            const name = table?.name ?? "表格";
            return <div key={tab.kind} className="flex h-full shrink-0 items-center border-r border-border">
              <TabsTrigger value={tab.kind} className="h-full max-w-48 rounded-none border-b-2 border-transparent px-3 text-xs data-[state=active]:border-primary data-[state=active]:bg-muted/50 data-[state=active]:shadow-none" aria-label={`${type?.label ?? tab.kind} · ${name}`}>{tab.kind === "table" && <TableIcon name={table?.icon} className="size-3.5 shrink-0" />}<span className="truncate">{type?.label ?? tab.kind} · {name}</span></TabsTrigger>
              <Button variant="ghost" size="icon" className="mr-1 size-6 shrink-0" aria-label={`关闭${type?.label ?? tab.kind} Tab`} onClick={() => onCloseTab(tab.kind)}><X className="size-3" /></Button>
            </div>;
          })}
        </TabsList>
        {tabs.map((tab) => <TabsContent key={`${tab.kind}:${tab.tableId}:${tab.viewId ?? ""}`} value={tab.kind} forceMount hidden={tab.kind !== activeKind} className="min-h-0 overflow-hidden data-[state=inactive]:hidden">
          {getPreviewSlotRenderer(tab.kind)?.(contexts[tab.kind]) ?? <p className="p-4 text-sm text-muted-foreground">暂无内容</p>}
        </TabsContent>)}
      </Tabs>}
  </section>;
}
