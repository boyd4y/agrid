import type { ReactNode } from "react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  getPreviewSlotRenderer,
  registerPreviewSlot,
  type PreviewSlotContext,
  type PreviewSlotKind,
} from "./preview-slot";
import { TablePreviewContent } from "./TablePreviewContent";
import { FormPreviewContent } from "./FormPreviewContent";

// Default registration — table surface shared with /app/tables/:id
registerPreviewSlot("table", (ctx) => <TablePreviewContent {...ctx} />);
registerPreviewSlot("form", (ctx) => <FormPreviewContent {...ctx} />);

type Props = {
  kind?: PreviewSlotKind;
  context: PreviewSlotContext;
  className?: string;
  /** Optional override; when set, ignores registry for this render */
  children?: ReactNode;
  /** Collapse the right UI slot (Harness / Codex style) */
  onCollapse?: () => void;
};

/**
 * Harness-style extensible right pane.
 * Swap `kind` later for diff / terminal / browser without changing chat layout.
 */
export function PreviewSlot({
  kind = "table",
  context,
  className,
  children,
  onCollapse,
}: Props) {
  const renderer = useMemo(() => getPreviewSlotRenderer(kind), [kind]);
  const body = children ?? (renderer ? renderer({ ...context, onCollapse }) : null);

  return (
    <section
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background",
        className
      )}
      data-preview-slot={kind}
      data-testid="workspace-preview-slot"
    >
      {body ?? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          未注册的预览槽：{kind}
        </div>
      )}
    </section>
  );
}

export { registerPreviewSlot, type PreviewSlotKind, type PreviewSlotContext };
