import { useCallback, useEffect, useRef, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import { useOutletContext } from "react-router-dom";
import { ChatPanel, type OpenPreviewPayload } from "@/components/chat/ChatPanel";
import { PreviewSlot } from "@/components/preview/PreviewSlot";
import { getPreviewTabKey, type PreviewSlotContext, type PreviewTab } from "@/components/preview/preview-slot";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@tabdo/ui/components/resizable";
import type { AppOutletContext } from "@/layouts/AppShell";
import { api } from "@/lib/api";
import type { FullTable } from "@/types/table";
import { AppPageHeader } from "@/components/shell/AppPage";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "@/hooks/useMediaQuery";

export function WorkspaceHomePage() {
  const { t } = useTranslation(["app", "errors"]);
  const { tables, notifyTableMutated, getTableRefreshToken } = useOutletContext<AppOutletContext>();
  const previewPanelRef = usePanelRef();
  const expandedSize = useRef(50);
  const narrow = useMediaQuery("(max-width: 767px)");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [tabs, setTabs] = useState<PreviewTab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [siteRefreshTokens, setSiteRefreshTokens] = useState<Record<string, number>>({});
  const [cache, setCache] = useState<Record<string, FullTable>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [createError, setCreateError] = useState<string | null>(null);
  const versions = useRef<Record<string, number>>({});
  const creating = useRef(false);

  const loadTable = useCallback(async (id: string) => {
    const version = (versions.current[id] ?? 0) + 1;
    versions.current[id] = version;
    setLoading((previous) => ({ ...previous, [id]: true }));
    setErrors((previous) => ({ ...previous, [id]: null }));
    try {
      const full = await api.getTable(id);
      if (versions.current[id] === version) setCache((previous) => ({ ...previous, [id]: { ...full, rows: full.rows ?? [], rowCount: full.rowCount ?? 0 } }));
    } catch (error) {
      if (versions.current[id] === version) setErrors((previous) => ({ ...previous, [id]: error instanceof Error ? error.message : t("errors:loadFailed") }));
    } finally {
      if (versions.current[id] === version) setLoading((previous) => ({ ...previous, [id]: false }));
    }
  }, [t]);

  // One request per dataset, even when several open Tabs use it. Reads never notify writes.
  const refreshSignature = JSON.stringify([...new Set(tabs.flatMap(tab => tab.tableId ? [tab.tableId] : []))].sort().map((id) => [id, getTableRefreshToken(id)]));
  useEffect(() => {
    for (const [id] of JSON.parse(refreshSignature) as [string, number][]) void loadTable(id);
  }, [refreshSignature, loadTable]);

  const openTab = useCallback((tab: PreviewTab) => {
    const key = getPreviewTabKey(tab);
    setTabs(previous => previous.some(entry => getPreviewTabKey(entry) === key) ? previous : [...previous, tab]);
    setActiveKey(key);
    setPreviewOpen(true);
  }, []);

  const closeTab = (key: string) => {
    const remaining = tabs.filter(tab => getPreviewTabKey(tab) !== key);
    setTabs(remaining);
    if (activeKey === key) setActiveKey(remaining.length ? getPreviewTabKey(remaining[remaining.length - 1]) : null);
  };

  const createTable = async () => {
    if (creating.current) return;
    creating.current = true;
    setCreateError(null);
    try {
      const table = await api.createTable(t("tables.newTableName", { n: tables.length + 1 }));
      openTab({ kind: "table", tableId: table.id });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t("errors:createTableFailed"));
    } finally { creating.current = false; }
  };

  useEffect(() => {
    if (previewOpen) previewPanelRef.current?.resize(`${expandedSize.current}%`);
    else previewPanelRef.current?.collapse();
  }, [previewOpen, previewPanelRef]);

  const handleOpenPreview = useCallback((payload: OpenPreviewPayload) => {
    const current = tabs.find(tab => getPreviewTabKey(tab) === activeKey);
    const kind = payload.kind ?? current?.kind ?? "table";
    if (kind === "site" && payload.siteId) { openTab({ kind, siteId: payload.siteId }); setPreviewOpen(payload.open !== false); return; }
    const tableId = payload.tableId ?? (current?.kind === kind ? current.tableId : tabs.filter(tab => tab.kind === kind).at(-1)?.tableId);
    if (tableId) openTab({ kind, tableId, viewId: payload.viewId });
    setPreviewOpen(payload.open !== false);
  }, [activeKey, tabs, openTab]);

  useEffect(() => {
    const listener = (event: Event) => handleOpenPreview((event as CustomEvent<OpenPreviewPayload>).detail ?? {});
    window.addEventListener("tabdo:open-preview", listener);
    return () => window.removeEventListener("tabdo:open-preview", listener);
  }, [handleOpenPreview]);

  const contexts: Record<string, PreviewSlotContext> = {};
  for (const tab of tabs) contexts[getPreviewTabKey(tab)] = {
    active: getPreviewTabKey(tab) === activeKey && previewOpen, siteId: tab.siteId, tableId: tab.tableId ?? null, viewId: tab.viewId, table: cache[tab.tableId ?? ""] ?? null,
    refreshToken: getTableRefreshToken(tab.tableId) + (siteRefreshTokens[getPreviewTabKey(tab)] ?? 0),
    setTable: (table) => setCache((previous) => ({ ...previous, [tab.tableId ?? ""]: table })),
    loading: loading[tab.tableId ?? ""] ?? !cache[tab.tableId ?? ""], error: errors[tab.tableId ?? ""] ?? null,
    onRefresh: () => tab.kind === "site" ? setSiteRefreshTokens(previous => ({ ...previous, [getPreviewTabKey(tab)]: (previous[getPreviewTabKey(tab)] ?? 0) + 1 })) : notifyTableMutated(tab.tableId), tablesMeta: tables,
    onSelectTable: (id) => openTab({ kind: tab.kind, tableId: id }),
    onCreateTable: () => { void createTable(); },
  };

  return <div className="flex h-full min-h-0 min-w-0 w-full flex-col bg-background" data-testid="workspace-home-split" data-preview-open={previewOpen ? "true" : "false"}>
    <AppPageHeader page="ai" description={t("ai.description")} />
    <div className="min-h-0 min-w-0 flex-1">
      <ResizablePanelGroup orientation={narrow ? "vertical" : "horizontal"} id="workspace-home" className="h-full min-h-0 w-full">
        <ResizablePanel id="workspace-chat" defaultSize="50%" minSize="22%" className="flex h-full min-h-0 flex-col">
          <ChatPanel tableId={null} resourceKey="workspace" onMutated={notifyTableMutated} onOpenPreview={handleOpenPreview} previewOpen={previewOpen} onTogglePreview={() => setPreviewOpen((open) => !open)} variant="home" />
        </ResizablePanel>
        <ResizableHandle withHandle data-testid="workspace-resize-handle" className={previewOpen ? undefined : "hidden"} />
        <ResizablePanel id="workspace-preview" panelRef={previewPanelRef} defaultSize="50%" minSize={narrow ? "22%" : "264px"} maxSize="78%" collapsible collapsedSize="0%" onResize={(size) => {
          if (size.asPercentage > 0) expandedSize.current = size.asPercentage;
          setPreviewOpen(size.asPercentage > 0);
        }} className="flex h-full min-h-0 flex-col">
          <div id="workspace-preview-panel" className="h-full min-h-0 min-w-0" hidden={!previewOpen}>
            {createError && <p role="alert" className="p-3 text-sm text-destructive">{createError}</p>}
            <PreviewSlot tabs={tabs} activeKey={activeKey} contexts={contexts} tables={tables} onOpenTab={openTab} onCloseTab={closeTab} onSelectTab={setActiveKey} />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  </div>;
}
