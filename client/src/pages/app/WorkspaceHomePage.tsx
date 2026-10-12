import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ChatPanel, type OpenPreviewPayload } from "@/components/chat/ChatPanel";
import { PreviewSlot } from "@/components/preview/PreviewSlot";
import type { PreviewSlotKind } from "@/components/preview/preview-slot";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { AppOutletContext } from "@/layouts/AppShell";
import { useAppShell } from "@/context/AppShellContext";
import { api } from "@/lib/api";
import type { FullTable } from "@/types/table";
import { AppPageHeader } from "@/components/shell/AppPage";

/**
 * Harness / Codex style workspace home:
 * — left: agent chat (assistant-ui + harness tools), full height
 * — right: extensible PreviewSlot plugin — default CLOSED; opens on demand via open_preview tool
 * — drag middle handle to resize; preview fills full height when open
 */
export function WorkspaceHomePage() {
  const { tables, createTable, notifyTableMutated, tableRefreshToken } =
    useOutletContext<AppOutletContext>();
  const { activeTableId, setActiveTableId, setAiOpen } = useAppShell();
  const [full, setFull] = useState<FullTable | null>(null);
  const [loadingTable, setLoadingTable] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Tool-driven UI slot: closed by default (not persisted). */
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewKind, setPreviewKind] = useState<PreviewSlotKind>("table");
  const [previewViewId, setPreviewViewId] = useState<string | null>(null);

  // Home owns the chat split; keep drawer closed
  useEffect(() => {
    setAiOpen(false);
  }, [setAiOpen]);

  useEffect(() => {
    if (!activeTableId && tables[0]) {
      setActiveTableId(tables[0].id);
    }
  }, [tables, activeTableId, setActiveTableId]);

  const boundId = activeTableId ?? tables[0]?.id ?? null;

  const loadTable = useCallback(async (id: string) => {
    setLoadingTable(true);
    setLoadError(null);
    try {
      const t = await api.getTable(id);
      setFull({ ...t, rows: t.rows ?? [], rowCount: t.rowCount ?? 0 });
    } catch (e) {
      setFull(null);
      setLoadError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoadingTable(false);
    }
  }, []);

  useEffect(() => {
    if (!previewOpen) return;
    if (boundId) void loadTable(boundId);
    else setFull(null);
  }, [boundId, loadTable, tableRefreshToken, previewOpen]);

  const tablesMeta = useMemo(
    () => tables.map((t) => ({ id: t.id, name: t.name })),
    [tables]
  );

  const previewCtx = useMemo(
    () => ({
      tableId: boundId,
      viewId: previewViewId,
      table: full,
      setTable: setFull,
      loading: loadingTable,
      error: loadError,
      onRefresh: () => {
        if (boundId) void loadTable(boundId);
      },
      tablesMeta,
      onSelectTable: (id: string) => setActiveTableId(id),
      onCreateTable: () => {
        void createTable();
      },
    }),
    [
      boundId,
      previewViewId,
      full,
      loadingTable,
      loadError,
      loadTable,
      tablesMeta,
      setActiveTableId,
      createTable,
    ]
  );

  const handleOpenPreview = useCallback(
    (payload: OpenPreviewPayload) => {
      const shouldOpen = payload.open !== false;
      if (payload.kind) setPreviewKind(payload.kind);
      if (payload.tableId) setActiveTableId(payload.tableId);
      if (payload.viewId !== undefined) setPreviewViewId(payload.viewId ?? null);
      setPreviewOpen(shouldOpen);
    },
    [setActiveTableId]
  );

  // Bridge: chat tools + optional window event (agrid:open-preview)
  useEffect(() => {
    const onEvt = (e: Event) => {
      const detail = (e as CustomEvent<OpenPreviewPayload>).detail ?? {};
      handleOpenPreview(detail);
    };
    window.addEventListener("agrid:open-preview", onEvt);
    return () => window.removeEventListener("agrid:open-preview", onEvt);
  }, [handleOpenPreview]);

  const chatPane = (
    <aside className="flex h-full min-h-0 w-full flex-col">
      <div className="min-h-0 flex-1">
        <ChatPanel
          tableId={boundId}
          onMutated={notifyTableMutated}
          onOpenPreview={handleOpenPreview}
          variant="home"
        />
      </div>
    </aside>
  );

  return (
    <div
      className="flex h-full min-h-0 min-w-0 w-full flex-col bg-background"
      data-testid="workspace-home-split"
      data-preview-open={previewOpen ? "true" : "false"}
    >
      <AppPageHeader
        page="ai"
        description="与智能体对话，创建表格、整理数据和配置自动化。"
      />
      <div className="min-h-0 min-w-0 flex-1">
      {previewOpen ? (
        <ResizablePanelGroup
          orientation="horizontal"
          id="workspace-home"
          className="h-full min-h-0 w-full"
        >
          <ResizablePanel
            id="workspace-chat"
            defaultSize="50%"
            minSize="22%"
            maxSize="78%"
            className="flex h-full min-h-0 flex-col"
          >
            {chatPane}
          </ResizablePanel>

          <ResizableHandle withHandle data-testid="workspace-resize-handle" />

          <ResizablePanel
            id="workspace-preview"
            defaultSize="50%"
            minSize="22%"
            className="flex h-full min-h-0 flex-col"
          >
            <PreviewSlot
              kind={previewKind}
              context={previewCtx}
              className="h-full min-h-0"
              onCollapse={() => setPreviewOpen(false)}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="flex h-full min-h-0 w-full flex-1">
          <div className="min-h-0 min-w-0 flex-1">{chatPane}</div>
        </div>
      )}
      </div>
    </div>
  );
}
