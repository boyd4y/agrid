import { SitePreviewContent } from "./SitePreviewContent";
import { ChevronDown, FileInput, Plus, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@tabdo/ui/components/tabs";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuGroup } from "@tabdo/ui/components/dropdown-menu";
import { TableIcon } from "@/components/table/TableIcon";
import { APP_NAVIGATION } from "@/components/shell/app-navigation";
import { getPreviewSlotRenderer, registerPreviewSlot, type PreviewSlotContext, type PreviewSlotKind, type PreviewTab } from "./preview-slot";
import { TablePreviewContent } from "./TablePreviewContent";
import { FormPreviewContent } from "./FormPreviewContent";
import { AutomationPreviewContent } from "./AutomationPreviewContent";

registerPreviewSlot("site", ctx => <SitePreviewContent {...ctx} />);
registerPreviewSlot("table", (ctx) => <TablePreviewContent {...ctx} />);
registerPreviewSlot("form", (ctx) => <FormPreviewContent {...ctx} />);
registerPreviewSlot("automations", (ctx) => <AutomationPreviewContent {...ctx} />);

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
  const { t } = useTranslation("app");
  const TYPES = [
    { kind: "table" as const, label: t("preview.table"), icon: APP_NAVIGATION.tables.icon },
    { kind: "form" as const, label: t("preview.form"), icon: FileInput },
    { kind: "automations" as const, label: t("preview.automations"), icon: APP_NAVIGATION.automations.icon },
  ];
  return <section className="flex h-full min-h-0 min-w-0 flex-col bg-background" data-testid="workspace-preview-slot">
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
      {TYPES.map(({ kind, label, icon: Icon }) => <DropdownMenu key={kind}>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-8 px-2 text-xs" aria-label={t("preview.openKind", { label })}><Icon className="size-3.5" />{label}<ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{kind === "table" ? t("preview.pickTable") : t("preview.pickTableFor", { label })}</DropdownMenuLabel>
          <DropdownMenuGroup>{tables.map((table) => <DropdownMenuItem key={table.id} onSelect={() => onOpenTab({ kind, tableId: table.id })}><TableIcon name={table.icon} className="size-4 shrink-0" />{table.name}</DropdownMenuItem>)}
          {!tables.length && <DropdownMenuItem disabled>{t("preview.noTables")}</DropdownMenuItem>}</DropdownMenuGroup>
          {kind === "table" && <><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuItem onSelect={onCreateTable}><Plus className="size-3.5" />{t("preview.newTable")}</DropdownMenuItem></DropdownMenuGroup></>}
        </DropdownMenuContent>
      </DropdownMenu>)}
      {activeKind && <Button variant="ghost" size="icon" className="ml-auto size-8 shrink-0" aria-label={t("preview.refreshPanel")} title={t("preview.refreshPanel")} onClick={() => contexts[activeKind]?.onRefresh()}><RefreshCw className="size-3.5" /></Button>}
    </div>
    {!tabs.length ? <p className="p-4 text-sm text-muted-foreground">{t("preview.emptyHint")}</p> :
      <Tabs value={activeKind ?? ""} onValueChange={onSelectTab} className="min-h-0 flex-1 gap-0">
        <TabsList aria-label={t("preview.openTabs")} className="h-10 w-full shrink-0 justify-start overflow-x-auto rounded-none border-b border-border bg-transparent p-0">
          {tabs.map((tab) => {
            const type = TYPES.find((type) => type.kind === tab.kind);
            const table = tables.find((table) => table.id === tab.tableId);
            const name = tab.kind === "site" ? t("nav.sites") : table?.name ?? t("preview.table");
            return <div key={tab.kind} className="flex h-full shrink-0 items-center border-r border-border">
              <TabsTrigger value={tab.kind} className="h-full max-w-48 rounded-none border-b-2 border-transparent px-3 text-xs data-[state=active]:border-primary data-[state=active]:bg-muted/50 data-[state=active]:shadow-none" aria-label={`${type?.label ?? (tab.kind === "site" ? t("nav.sites") : tab.kind)} · ${name}`}>{tab.kind === "table" && <TableIcon name={table?.icon} className="size-3.5 shrink-0" />}<span className="truncate">{type?.label ?? (tab.kind === "site" ? t("nav.sites") : tab.kind)} · {name}</span></TabsTrigger>
              <Button variant="ghost" size="icon" className="mr-1 size-6 shrink-0" aria-label={t("preview.closeTab", { label: type?.label ?? (tab.kind === "site" ? t("nav.sites") : tab.kind) })} onClick={() => onCloseTab(tab.kind)}><X className="size-3" /></Button>
            </div>;
          })}
        </TabsList>
        {tabs.map((tab) => <TabsContent key={`${tab.kind}:${tab.siteId ?? tab.tableId}:${tab.viewId ?? ""}`} value={tab.kind} forceMount hidden={tab.kind !== activeKind} className="min-h-0 overflow-hidden data-[state=inactive]:hidden">
          {getPreviewSlotRenderer(tab.kind)?.(contexts[tab.kind]) ?? <p className="p-4 text-sm text-muted-foreground">{t("preview.noContent")}</p>}
        </TabsContent>)}
      </Tabs>}
  </section>;
}
