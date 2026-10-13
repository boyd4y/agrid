import { useCallback, useEffect, useRef, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import { useOutletContext } from "react-router-dom";
import { ChatPanel, type OpenPreviewPayload } from "@/components/chat/ChatPanel";
import { PreviewSlot } from "@/components/preview/PreviewSlot";
import type { PreviewSlotContext, PreviewSlotKind, PreviewTab } from "@/components/preview/preview-slot";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import type { AppOutletContext } from "@/layouts/AppShell";
import { api } from "@/lib/api";
import type { FullTable } from "@/types/table";
import { AppPageHeader } from "@/components/shell/AppPage";

export function WorkspaceHomePage() {
  const { tables, notifyTableMutated, getTableRefreshToken } = useOutletContext<AppOutletContext>();
  const previewPanelRef = usePanelRef();
  const [previewOpen, setPreviewOpen] = useState(true);
  const [tabs, setTabs] = useState<PreviewTab[]>([]);
  const [activeKind, setActiveKind] = useState<PreviewSlotKind | null>(null);
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
      if (versions.current[id] === version) setErrors((previous) => ({ ...previous, [id]: error instanceof Error ? error.message : "加载失败" }));
    } finally {
      if (versions.current[id] === version) setLoading((previous) => ({ ...previous, [id]: false }));
    }
  }, []);

  // One request per dataset, even when several open Tabs use it. Reads never notify writes.
  const refreshSignature = JSON.stringify([...new Set(tabs.map((tab) => tab.tableId))].sort().map((id) => [id, getTableRefreshToken(id)]));
  useEffect(() => {
    for (const [id] of JSON.parse(refreshSignature) as [string, number][]) void loadTable(id);
  }, [refreshSignature, loadTable]);

  const openTab = useCallback((tab: PreviewTab) => {
    setTabs((previous) => previous.some((entry) => entry.kind === tab.kind)
      ? previous.map((entry) => entry.kind === tab.kind ? tab : entry) : [...previous, tab]);
    setActiveKind(tab.kind);
    setPreviewOpen(true);
  }, []);

  const closeTab = (kind: PreviewSlotKind) => {
    const remaining = tabs.filter((tab) => tab.kind !== kind);
    setTabs(remaining);
    if (activeKind === kind) setActiveKind(remaining.at(-1)?.kind ?? null);
  };

  const createTable = async () => {
    if (creating.current) return;
    creating.current = true;
    setCreateError(null);
    try {
      const table = await api.createTable(`新表格 ${tables.length + 1}`);
      openTab({ kind: "table", tableId: table.id });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "创建表格失败");
    } finally { creating.current = false; }
  };

  useEffect(() => {
    if (previewOpen) previewPanelRef.current?.expand();
    else previewPanelRef.current?.collapse();
  }, [previewOpen, previewPanelRef]);

  const handleOpenPreview = useCallback((payload: OpenPreviewPayload) => {
    const kind = payload.kind ?? activeKind ?? "table";
    const tableId = payload.tableId ?? tabs.find((tab) => tab.kind === kind)?.tableId;
    if (tableId) openTab({ kind, tableId, viewId: payload.viewId });
    setPreviewOpen(payload.open !== false);
  }, [activeKind, tabs, openTab]);

  useEffect(() => {
    const listener = (event: Event) => handleOpenPreview((event as CustomEvent<OpenPreviewPayload>).detail ?? {});
    window.addEventListener("agrid:open-preview", listener);
    return () => window.removeEventListener("agrid:open-preview", listener);
  }, [handleOpenPreview]);

  const contexts: Record<string, PreviewSlotContext> = {};
  for (const tab of tabs) contexts[tab.kind] = {
    active: tab.kind === activeKind && previewOpen, tableId: tab.tableId, viewId: tab.viewId, table: cache[tab.tableId] ?? null,
    refreshToken: getTableRefreshToken(tab.tableId),
    setTable: (table) => setCache((previous) => ({ ...previous, [tab.tableId]: table })),
    loading: loading[tab.tableId] ?? !cache[tab.tableId], error: errors[tab.tableId] ?? null,
    onRefresh: () => notifyTableMutated(tab.tableId), tablesMeta: tables,
    onSelectTable: (id) => openTab({ kind: tab.kind, tableId: id }),
    onCreateTable: () => { void createTable(); },
  };

  return <div className="flex h-full min-h-0 min-w-0 w-full flex-col bg-background" data-testid="workspace-home-split" data-preview-open={previewOpen ? "true" : "false"}>
    <AppPageHeader page="ai" description="与智能体对话，创建表格、整理数据和配置自动化。" />
    <div className="min-h-0 min-w-0 flex-1">
      <ResizablePanelGroup orientation="horizontal" id="workspace-home" className="h-full min-h-0 w-full">
        <ResizablePanel id="workspace-chat" defaultSize="50%" minSize="22%" className="flex h-full min-h-0 flex-col">
          <ChatPanel tableId={null} resourceKey="workspace" onMutated={notifyTableMutated} onOpenPreview={handleOpenPreview} previewOpen={previewOpen} onTogglePreview={() => setPreviewOpen((open) => !open)} variant="home" />
        </ResizablePanel>
        <ResizableHandle withHandle data-testid="workspace-resize-handle" className={previewOpen ? undefined : "hidden"} />
        <ResizablePanel id="workspace-preview" panelRef={previewPanelRef} defaultSize="50%" minSize="22%" maxSize="78%" collapsible collapsedSize="0%" onResize={(size) => setPreviewOpen(size.asPercentage > 0)} className="flex h-full min-h-0 flex-col">
          <div id="workspace-preview-panel" className="h-full min-h-0 min-w-0" hidden={!previewOpen}>
            {createError && <p role="alert" className="p-3 text-sm text-destructive">{createError}</p>}
            <PreviewSlot tabs={tabs} activeKind={activeKind} contexts={contexts} tables={tables} onOpenTab={openTab} onCloseTab={closeTab} onSelectTab={setActiveKind} onCreateTable={() => { void createTable(); }} />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  </div>;
}
