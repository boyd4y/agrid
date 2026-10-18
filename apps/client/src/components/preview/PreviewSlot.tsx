import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChartNoAxesCombined, FileInput, Home, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
import { Tabs, TabsList, TabsTrigger } from "@tabdo/ui/components/tabs";
import { APP_NAVIGATION } from "@/components/shell/app-navigation";
import { cn } from "@tabdo/ui/lib/utils";
import { getPreviewTabKey, getPreviewSlotRenderer, registerPreviewSlot, type PreviewSlotContext, type PreviewSlotHeader, type PreviewTab } from "./preview-slot";
import { PREVIEW_SHORTCUTS, previewShortcutLabel } from "./preview-shortcuts";
import { workspaceCacheKey } from "@/lib/workspace-scope";
import { PreviewResourceList } from "@/components/preview/PreviewResourceList";
import { PreviewResourcePicker } from "./PreviewResourcePicker";
import { SitePreviewContent } from "./SitePreviewContent";
import { TablePreviewContent } from "./TablePreviewContent";
import { ReportPreviewContent } from "./ReportPreviewContent";
import { FormPreviewContent } from "./FormPreviewContent";
import { AutomationPreviewContent } from "./AutomationPreviewContent";

registerPreviewSlot("site", ctx => <SitePreviewContent {...ctx} />);
registerPreviewSlot("table", ctx => <TablePreviewContent {...ctx} />);
registerPreviewSlot("report", ctx => <ReportPreviewContent {...ctx} />);
registerPreviewSlot("form", ctx => <FormPreviewContent {...ctx} />);
registerPreviewSlot("automations", ctx => <AutomationPreviewContent {...ctx} />);

const icons = { table: APP_NAVIGATION.tables.icon, site: APP_NAVIGATION.sites.icon, report: ChartNoAxesCombined, form: FileInput, automations: APP_NAVIGATION.automations.icon };
type Props = {
  choosingKind: string | null;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  tabs: PreviewTab[];
  activeKey: string | null;
  selectedKeys: Record<string, string>;
  contexts: Record<string, PreviewSlotContext>;
  tables: { id: string; name: string }[];
  onOpenTab: (tab: PreviewTab) => void;
  onOpenType: (kind: string) => void;
  onCloseTab: (kind: string) => void;
  onSelectTab: (key: string) => void;
  onShowTables: () => void;
};

/** Visible identity is the type; mounted content identity remains the stable resource ID. */
export function PreviewSlot({ choosingKind, pickerOpen, onPickerOpenChange, tabs, activeKey, selectedKeys, contexts, tables, onOpenTab, onOpenType, onCloseTab, onSelectTab, onShowTables }: Props) {
  const { t } = useTranslation("app");
  const [headers, setHeaders] = useState<Record<string, PreviewSlotHeader | null>>({});
  const headerRef = useRef<HTMLElement>(null);
  const launcherRef = useRef<HTMLDivElement>(null);
  const previousChoosingKind = useRef(choosingKind);
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const closeTabRef = useRef(onCloseTab); closeTabRef.current = onCloseTab;
  const headerCallbacks = useMemo(() => Object.fromEntries(tabs.map(tab => {
    const key = getPreviewTabKey(tab);
    return [key, (header: PreviewSlotHeader | null) => setHeaders(previous => ({ ...previous, [key]: header }))];
  })), [tabs]);
  const activeTab = tabs.find(tab => getPreviewTabKey(tab) === activeKey);
  const header = activeTab ? headers[getPreviewTabKey(activeTab)] : null;
  const kinds = [...new Set(tabs.map(tab => tab.kind))];
  const label = (kind: string) => t(`preview.${kind}`, { defaultValue: kind });
  useLayoutEffect(() => {
    if (previousChoosingKind.current && !choosingKind && !activeTab) {
      launcherRef.current?.querySelector<HTMLElement>(`[data-preview-kind="${previousChoosingKind.current}"]`)?.focus();
    }
    previousChoosingKind.current = choosingKind;
  }, [choosingKind, activeTab]);
  useLayoutEffect(() => {
    const active = activeTabRef.current, list = active?.parentElement;
    if (!active || !list) return;
    const reveal = () => {
      const bounds = list.getBoundingClientRect(), item = active.getBoundingClientRect();
      if (item.left < bounds.left) list.scrollLeft += item.left - bounds.left;
      else if (item.right > bounds.right) list.scrollLeft += item.right - bounds.right;
    };
    reveal(); const observer = new ResizeObserver(reveal); observer.observe(list); observer.observe(active);
    return () => observer.disconnect();
  }, [activeKey, tabs, headers]);
  const closeType = (kind: string) => {
    // Run every resource's guard, including inactive cached blog drafts. A guard
    // can cancel by withholding its continuation; nothing is unmounted early.
    const resources = tabs.filter(tab => tab.kind === kind);
    const check = (index: number) => {
      if (index < resources.length) {
        const guard = headers[getPreviewTabKey(resources[index])]?.beforeClose;
        if (guard) guard(() => check(index + 1)); else check(index + 1);
        return;
      }
      setHeaders(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !resources.some(tab => getPreviewTabKey(tab) === key))));
      closeTabRef.current(kind);
      requestAnimationFrame(() => {
        const target = headerRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? launcherRef.current?.querySelector<HTMLElement>("button");
        target?.focus();
      });
    };
    check(0);
  };
  return <section className="@container flex h-full min-h-0 min-w-0 flex-col bg-background" data-testid="workspace-preview-slot">
    <Tabs value={activeTab?.kind ?? ""} onValueChange={kind => { const key = selectedKeys[kind]; if (key) onSelectTab(key); }} className="min-h-0 min-w-0 flex-1 gap-0">
      <header ref={headerRef} className="flex h-11 min-w-0 shrink-0 items-center gap-0.5 border-b border-border px-1" data-testid="preview-slot-header">
        {activeTab ? <PreviewResourcePicker key={activeTab.kind} open={pickerOpen} onOpenChange={onPickerOpenChange} kind={activeTab.kind} selected={activeTab} title={header?.title} tables={tables} onSelect={onOpenTab} /> : <span className="min-w-0 flex-1 px-2 text-sm font-medium">{t("preview.title")}</span>}
        {kinds.length > 0 && <TabsList variant="line" aria-label={t("preview.openTabs")} className="h-full min-w-0 flex-1 justify-start overflow-x-auto">
          {kinds.map(kind => { const Icon = icons[kind as keyof typeof icons] ?? FileInput; return <TabsTrigger key={kind} value={kind} id={`preview-trigger-${kind}`} aria-controls={`preview-panel-${kind}`} ref={activeTab?.kind === kind ? activeTabRef : undefined} title={label(kind)} aria-label={label(kind)} className="h-full shrink-0 rounded-none px-2 text-xs"><Icon aria-hidden="true" className="size-4 shrink-0" /><span className="@max-[450px]:sr-only">{label(kind)}</span></TabsTrigger>; })}
        </TabsList>}
        {activeTab && <>
          {header?.actions}
          {(activeTab.tableId || activeTab.siteId || activeTab.reportId) && <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label={t("preview.refreshPanel")} title={t("preview.refreshPanel")} disabled={header?.refresh?.disabled || header?.refresh?.busy} onClick={() => (header?.refresh?.run ?? contexts[getPreviewTabKey(activeTab)]?.onRefresh)?.()}><RefreshCw className={cn(header?.refresh?.busy && "animate-spin motion-reduce:animate-none")} /></Button>}
          <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label={t("preview.closeTab", { label: label(activeTab.kind) })} onClick={() => closeType(activeTab.kind)}><X /></Button>
        </>}
        {kinds.length > 0 && <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label={t("preview.home")} title={t("preview.home")} aria-pressed={!activeTab} onClick={onShowTables}><Home /></Button>}
      </header>
      {!activeTab && !choosingKind && <div ref={launcherRef} role="region" aria-label={t("preview.title")} className="flex min-h-0 min-w-0 flex-1 overflow-auto p-4" data-testid="preview-launcher">
        <div className="m-auto flex w-full max-w-96 shrink-0 flex-col gap-3">{PREVIEW_SHORTCUTS.map((kind, index) => { const Icon = icons[kind]; return <Button key={kind} data-preview-kind={kind} variant="secondary" className="h-20 w-full justify-start gap-4 border border-border px-5 @max-[360px]:gap-3 @max-[360px]:px-3 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none" aria-keyshortcuts={`Control+Shift+${index + 1}`} onClick={() => onOpenType(kind)}><Icon aria-hidden="true" className="size-5 shrink-0" /><span className="flex-1 text-left text-base">{label(kind)}</span><kbd className="rounded border border-border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">{previewShortcutLabel(index)}</kbd></Button>; })}</div>
      </div>}
      {choosingKind && <div role="region" aria-label={t("preview.chooseType", { type: label(choosingKind) })} className="flex min-h-0 min-w-0 flex-1 overflow-hidden p-4" data-testid="preview-resource-step" onKeyDown={event => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); onShowTables(); }
      }}>
        <div className="m-auto flex max-h-full w-full max-w-96 min-h-0 flex-col gap-3">
          <div className="flex shrink-0 items-center gap-2"><Button variant="ghost" size="icon" aria-label={t("preview.back")} onClick={onShowTables}><ArrowLeft data-icon="inline-start" /></Button><h2 className="min-w-0 truncate text-sm font-medium">{t("preview.chooseType", { type: label(choosingKind) })}</h2></div>
          <div className="flex min-h-0 flex-col rounded-lg border border-border bg-popover p-2"><PreviewResourceList key={`${workspaceCacheKey()}:${choosingKind}`} kind={choosingKind} onSelect={onOpenTab} /></div>
        </div>
      </div>}
      {tabs.map(tab => {
        const key = getPreviewTabKey(tab), visible = key === activeKey;
        const hasResource = Boolean(tab.tableId || tab.siteId || tab.reportId);
        return <div key={key} data-preview-resource-id={tab.siteId ?? tab.reportId ?? tab.tableId} role="tabpanel" id={selectedKeys[tab.kind] === key ? `preview-panel-${tab.kind}` : undefined} aria-labelledby={`preview-trigger-${tab.kind}`} aria-label={label(tab.kind)} hidden={!visible} className={cn("min-h-0 min-w-0 flex-1 overflow-hidden", !visible && "hidden")}>
          {hasResource ? getPreviewSlotRenderer(tab.kind)?.({ ...contexts[key], onHeaderChange: headerCallbacks[key] }) ?? <p className="p-4 text-sm text-muted-foreground">{t("preview.noContent")}</p> : <div className="flex h-full items-center justify-center p-5 text-center text-sm text-muted-foreground"><p>{t("preview.selectHint", { type: label(tab.kind) })}</p></div>}
        </div>;
      })}
    </Tabs>
  </section>;
}
