import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, FileInput, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@tabdo/ui/components/tabs";
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
  onShowTables: () => void;
};

export function PreviewSlot({ tabs, activeKey, contexts, tables, onOpenTab, onCloseTab, onSelectTab, onShowTables }: Props) {
  const { t } = useTranslation("app");
  const [headers, setHeaders] = useState<Record<string, PreviewSlotHeader | null>>({});
  const headerRef = useRef<HTMLElement>(null);
  const launcherRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLDivElement>(null);
  const closeTabRef = useRef(onCloseTab); closeTabRef.current = onCloseTab;
  const headerCallbacks = useMemo(() => Object.fromEntries(tabs.map(tab => {
    const key = getPreviewTabKey(tab);
    return [key, (header: PreviewSlotHeader | null) => setHeaders(previous => ({ ...previous, [key]: header }))];
  })), [tabs]);
  const activeTab = tabs.find(tab => getPreviewTabKey(tab) === activeKey);
  const header = activeTab ? headers[getPreviewTabKey(activeTab)] : null;
  const showTables = !activeTab;
  const nameCounts = new Map<string, number>();
  const nameOrdinals = new Map<string, number>();
  for (const table of tables) {
    const ordinal = (nameCounts.get(table.name) ?? 0) + 1;
    nameCounts.set(table.name, ordinal);
    nameOrdinals.set(table.id, ordinal);
  }
  useLayoutEffect(() => {
    const active = activeTabRef.current, list = active?.parentElement;
    if (!active || !list) return;
    const revealActive = () => {
      const bounds = list.getBoundingClientRect(), item = active.getBoundingClientRect();
      if (!bounds.width || !item.width) return;
      // Scroll only the tab strip, including the close action; keep the page in place.
      if (item.left < bounds.left) list.scrollLeft += item.left - bounds.left;
      else if (item.right > bounds.right) list.scrollLeft += item.right - bounds.right;
    };
    revealActive();
    const observer = new ResizeObserver(revealActive);
    observer.observe(list);
    observer.observe(active);
    return () => observer.disconnect();
  }, [activeKey, tabs, headers]);
  const TableShortcutIcon = APP_NAVIGATION.tables.icon;
  return <section className="flex h-full min-h-0 min-w-0 flex-col bg-background" data-testid="workspace-preview-slot">
    <Tabs value={activeKey ?? ""} onValueChange={onSelectTab} className="min-h-0 min-w-0 flex-1 gap-0">
      <header ref={headerRef} className="flex h-11 min-w-0 shrink-0 items-center gap-1 border-b border-border px-2" data-testid="preview-slot-header">
        {!tabs.length && <span className="px-2 text-sm font-medium">{t("nav.tables")}</span>}
        {tabs.length > 0 && <TabsList variant="line" aria-label={t("preview.openTabs")} className="h-full min-w-0 flex-1 justify-start overflow-x-auto">
          {tabs.map(tab => {
            const table = tables.find(table => table.id === tab.tableId);
            const label = tab.kind === "site" ? t("nav.sites") : t(`preview.${tab.kind}`, { defaultValue: tab.kind });
            const name = headers[getPreviewTabKey(tab)]?.title ?? contexts[getPreviewTabKey(tab)]?.table?.name ?? table?.name ?? label;
            const Icon = tab.kind === "form" ? FileInput : tab.kind === "automations" ? APP_NAVIGATION.automations.icon : APP_NAVIGATION.sites.icon;
            return <div key={getPreviewTabKey(tab)} ref={getPreviewTabKey(tab) === activeKey ? activeTabRef : undefined} className="flex h-full max-w-full shrink-0 items-center">
              <TabsTrigger value={getPreviewTabKey(tab)} title={name} aria-label={`${label} · ${name}`} className="h-full min-w-0 max-w-44 rounded-none px-2 text-xs">
                {tab.kind === "table" ? <TableIcon name={table?.icon} className="size-4 shrink-0" /> : <Icon aria-hidden="true" />}
                <span className="truncate">{name}</span>
              </TabsTrigger>
              <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t("preview.closeTab", { label: `${label} · ${name}` })} onClick={() => {
                const close = () => {
                  closeTabRef.current(getPreviewTabKey(tab));
                  requestAnimationFrame(() => {
                    const target = headerRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
                      ?? launcherRef.current?.querySelector<HTMLElement>("button") ?? launcherRef.current;
                    target?.focus();
                  });
                };
                const beforeClose = headers[getPreviewTabKey(tab)]?.beforeClose;
                if (beforeClose) beforeClose(close);
                else close();
              }}><X /></Button>
            </div>;
          })}
        </TabsList>}
        {tabs.length > 0 && <Button variant="ghost" size="icon" className="shrink-0" aria-label={t("preview.tableList")} title={t("preview.tableList")} aria-pressed={showTables} onClick={onShowTables}><TableShortcutIcon /></Button>}
        {header?.actions}
        {activeTab && <Button variant="ghost" size="icon" className="shrink-0" aria-label={t("preview.refreshPanel")} title={t("preview.refreshPanel")} disabled={header?.refresh?.disabled || header?.refresh?.busy} onClick={() => (header?.refresh?.run ?? contexts[getPreviewTabKey(activeTab)]?.onRefresh)?.()}><RefreshCw className={cn(header?.refresh?.busy && "animate-spin motion-reduce:animate-none")} /></Button>}
      </header>
      {showTables && <div ref={launcherRef} role="region" aria-label={t("preview.tableList")} tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring sm:p-6" data-testid="preview-table-launcher">
        {tables.length ? <ul className="flex min-w-0 flex-col gap-3">
          {tables.map(table => {
            const disambiguator = (nameCounts.get(table.name) ?? 0) > 1 ? t("preview.duplicateTable", { index: nameOrdinals.get(table.id) }) : null;
            const label = disambiguator ? `${table.name} · ${disambiguator}` : table.name;
            return <li key={table.id} className="min-w-0">
              <Button variant="outline" className="h-auto min-h-16 w-full min-w-0 justify-start gap-3 whitespace-normal px-4 py-4 text-left shadow-none" data-table-id={table.id} aria-label={label} title={label} onClick={() => onOpenTab({ kind: "table", tableId: table.id })}>
                <TableIcon name={table.icon} className="size-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{table.name}</span>
                  {disambiguator && <span className="block truncate text-xs font-normal text-muted-foreground">{disambiguator}</span>}
                </span>
                <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              </Button>
            </li>;
          })}
        </ul> : <p role="status" className="py-8 text-center text-sm text-muted-foreground">{t("preview.noTables")}</p>}
      </div>}
      {tabs.map(tab => <TabsContent key={getPreviewTabKey(tab)} value={getPreviewTabKey(tab)} forceMount hidden={getPreviewTabKey(tab) !== activeKey} className="min-h-0 min-w-0 overflow-hidden data-[state=inactive]:hidden">
        {getPreviewSlotRenderer(tab.kind)?.({ ...contexts[getPreviewTabKey(tab)], onHeaderChange: headerCallbacks[getPreviewTabKey(tab)] }) ?? <p className="p-4 text-sm text-muted-foreground">{t("preview.noContent")}</p>}
      </TabsContent>)}
    </Tabs>
  </section>;
}
