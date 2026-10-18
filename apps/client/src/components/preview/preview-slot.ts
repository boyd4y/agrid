import type { ReactNode } from "react";
import type { FullTable } from "@/types/table";

/**
 * Extensible UI slot for chat-mode right pane (Harness / Codex style).
 * Tabs open on demand; "table" shares DataTable and data with /app/tables/:id.
 * Register more kinds (diff, terminal, browser, …) via registerPreviewSlot.
 */
export type PreviewSlotKind = "table" | "form" | "automations" | (string & {});

export type PreviewTab = { kind: PreviewSlotKind; tableId?: string; siteId?: string; reportId?: string; viewId?: string | null };

export const getPreviewTabKey = (tab: PreviewTab) => JSON.stringify([tab.kind, tab.siteId ?? tab.reportId ?? null, tab.tableId ?? null, tab.viewId ?? null]);

/** Resource-owned details/actions rendered in the slot's single header. */
export type PreviewSlotHeader = {
  title?: string;
  actions?: ReactNode;
  refresh?: { run: () => void; disabled?: boolean; busy?: boolean };
  beforeClose?: (close: () => void) => void;
};

export type PreviewSlotContext = {
  onHeaderChange?: (header: PreviewSlotHeader | null) => void;
  active?: boolean;
  siteId?: string;
  reportId?: string;
  tableId: string | null;
  /** Form view id when kind=form */
  viewId?: string | null;
  table: FullTable | null;
  refreshToken?: number;
  setTable: (table: FullTable) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  tablesMeta: { id: string; name: string }[];
  onSelectTable: (id: string) => void;
  onCreateTable: () => void;
};

export type PreviewSlotRenderer = (ctx: PreviewSlotContext) => ReactNode;

const registry = new Map<PreviewSlotKind, PreviewSlotRenderer>();

export function registerPreviewSlot(
  kind: PreviewSlotKind,
  render: PreviewSlotRenderer
) {
  registry.set(kind, render);
}

export function getPreviewSlotRenderer(
  kind: PreviewSlotKind
): PreviewSlotRenderer | undefined {
  return registry.get(kind);
}

export function listPreviewSlots(): PreviewSlotKind[] {
  return Array.from(registry.keys());
}
