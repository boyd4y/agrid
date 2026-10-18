import { useMemo, useRef, useState } from "react";
import { ChevronDown, FileInput, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@tabdo/ui/components/tabs";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuGroup } from "@tabdo/ui/components/dropdown-menu";
import { TableIcon } from "@/components/table/TableIcon";
import { APP_NAVIGATION } from "@/components/shell/app-navigation";
import { cn } from "@tabdo/ui/lib/utils";
import { getPreviewTabKey, getPreviewSlotRenderer, registerPreviewSlot, type PreviewSlotContext, type PreviewSlotHeader, type PreviewTab } from "./preview-slot";
import { SitePreviewContent } from "./SitePreviewContent";
import { TablePreviewContent } from "./TablePreviewContent";
import { FormPreviewContent } from "./FormPreviewContent";
import { AutomationPreviewContent } from "./AutomationPreviewContent";

registerPreviewSlot("site", ctx => <SitePreviewContent {...ctx} />);
registerPreviewSlot("table", ctx => <TablePreviewContent {...ctx} />);
registerPreviewSlot("form", ctx => <FormPreviewContent {...ctx} />);
registerPreviewSlot("automations", ctx => <AutomationPreviewContent {...ctx} />);

type Props = {
  tabs: PreviewTab[];
  activeKey: string | null;
  contexts: Record<string, PreviewSlotContext>;
  tables: { id: string; name: string; icon?: string | null }[];
  onOpenTab: (tab: PreviewTab) => void;
  onCloseTab: (key: string) => void;
  onSelectTab: (key: string) => void;
};

export function PreviewSlot({ tabs, activeKey, contexts, tables, onOpenTab, onCloseTab, onSelectTab }: Props) {
  const { t } = useTranslation("app");
  const [headers, setHeaders] = useState<Record<string, PreviewSlotHeader | null>>({});
  const headerRef = useRef<HTMLElement>(null);
  const closeTabRef = useRef(onCloseTab); closeTabRef.current = onCloseTab;
  const headerCallbacks = useMemo(() => Object.fromEntries(tabs.map(tab => {
    const key = getPreviewTabKey(tab);
    return [key, (header: PreviewSlotHeader | null) => setHeaders(previous => ({ ...previous, [key]: header }))];
  })), [tabs]);
  const activeTab = tabs.find(tab => getPreviewTabKey(tab) === activeKey);
  const header = activeTab ? headers[getPreviewTabKey(activeTab)] : null;
  const TableShortcutIcon = APP_NAVIGATION.tables.icon;
  return <section className="flex h-full min-h-0 min-w-0 flex-col bg-background" data-testid="workspace-preview-slot">
    <Tabs value={activeKey ?? ""} onValueChange={onSelectTab} className="min-h-0 min-w-0 flex-1 gap-0">
      <header ref={headerRef} className="flex h-11 min-w-0 shrink-0 items-center gap-1 border-b border-border px-2" data-testid="preview-slot-header">
        {tabs.length > 0 && <TabsList variant="line" aria-label={t("preview.openTabs")} className="h-full min-w-0 flex-1 justify-start overflow-x-auto">
          {tabs.map(tab => {
            const table = tables.find(table => table.id === tab.tableId);
            const label = tab.kind === "site" ? t("nav.sites") : t(`preview.${tab.kind}`, { defaultValue: tab.kind });
            const name = headers[getPreviewTabKey(tab)]?.title ?? contexts[getPreviewTabKey(tab)]?.table?.name ?? table?.name ?? label;
            const Icon = tab.kind === "form" ? FileInput : tab.kind === "automations" ? APP_NAVIGATION.automations.icon : APP_NAVIGATION.sites.icon;
            return <div key={getPreviewTabKey(tab)} className="flex h-full shrink-0 items-center">
              <TabsTrigger value={getPreviewTabKey(tab)} title={name} aria-label={`${label} · ${name}`} className="h-full min-w-0 max-w-44 rounded-none px-2 text-xs">
                {tab.kind === "table" ? <TableIcon name={table?.icon} className="size-4 shrink-0" /> : <Icon aria-hidden="true" />}
                <span className="truncate">{name}</span>
              </TabsTrigger>
              <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t("preview.closeTab", { label: `${label} · ${name}` })} onClick={() => {
                const close = () => {
                  closeTabRef.current(getPreviewTabKey(tab));
                  requestAnimationFrame(() => headerRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"], button[aria-haspopup="menu"]')?.focus());
                };
                const beforeClose = headers[getPreviewTabKey(tab)]?.beforeClose;
                if (beforeClose) beforeClose(close);
                else close();
              }}><X /></Button>
            </div>;
          })}
        </TabsList>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size={tabs.length ? "icon" : "sm"} className="shrink-0" aria-label={t("preview.openTable")} title={t("preview.openTable")}><TableShortcutIcon />{!tabs.length && <>{t("preview.openTable")}<ChevronDown /></>}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
            <DropdownMenuLabel>{t("preview.pickTable")}</DropdownMenuLabel>
            <DropdownMenuGroup>{tables.map(table => <DropdownMenuItem key={table.id} onSelect={() => onOpenTab({ kind: "table", tableId: table.id })}><TableIcon name={table.icon} className="size-4 shrink-0" /><span className="truncate">{table.name}</span></DropdownMenuItem>)}
              {!tables.length && <DropdownMenuItem disabled>{t("preview.noTables")}</DropdownMenuItem>}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {header?.actions}
        {activeTab && <Button variant="ghost" size="icon" className="shrink-0" aria-label={t("preview.refreshPanel")} title={t("preview.refreshPanel")} disabled={header?.refresh?.disabled || header?.refresh?.busy} onClick={() => (header?.refresh?.run ?? contexts[getPreviewTabKey(activeTab)]?.onRefresh)?.()}><RefreshCw className={cn(header?.refresh?.busy && "animate-spin motion-reduce:animate-none")} /></Button>}
      </header>
      {tabs.map(tab => <TabsContent key={getPreviewTabKey(tab)} value={getPreviewTabKey(tab)} forceMount hidden={getPreviewTabKey(tab) !== activeKey} className="min-h-0 min-w-0 overflow-hidden data-[state=inactive]:hidden">
        {getPreviewSlotRenderer(tab.kind)?.({ ...contexts[getPreviewTabKey(tab)], onHeaderChange: headerCallbacks[getPreviewTabKey(tab)] }) ?? <p className="p-4 text-sm text-muted-foreground">{t("preview.noContent")}</p>}
      </TabsContent>)}
    </Tabs>
  </section>;
}
