import type { ReactNode } from "react";
import type { FullTable } from "@/types/table";

/**
 * Extensible UI slot for chat-mode right pane (Harness / Codex style).
 * Default slot is "table" — same DataTable + same data source as /app/tables/:id.
 * Register more kinds (diff, terminal, browser, …) via registerPreviewSlot.
 */
export type PreviewSlotKind = "table" | "form" | (string & {});

export type PreviewSlotContext = {
  tableId: string | null;
  /** Form view id when kind=form */
  viewId?: string | null;
  table: FullTable | null;
  setTable: (table: FullTable) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  tablesMeta: { id: string; name: string }[];
  onSelectTable: (id: string) => void;
  onCreateTable: () => void;
  /** Collapse the right UI slot when provided by the host */
  onCollapse?: () => void;
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
