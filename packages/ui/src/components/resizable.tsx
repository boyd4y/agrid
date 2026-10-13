import {
  Group as ResizablePrimitiveGroup,
  Panel as ResizablePrimitivePanel,
  Separator as ResizablePrimitiveSeparator,
  type GroupProps,
  type PanelProps,
  type SeparatorProps,
} from "react-resizable-panels";
import { cn } from "@tabdo/ui/lib/utils";

/** Horizontal/vertical resizable group (react-resizable-panels v4). */
export function ResizablePanelGroup({
  className,
  orientation = "horizontal",
  ...props
}: GroupProps) {
  return (
    <ResizablePrimitiveGroup
      orientation={orientation}
      className={cn(
        "flex h-full w-full data-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  );
}

export function ResizablePanel({ className, ...props }: PanelProps) {
  return (
    <ResizablePrimitivePanel
      className={cn("min-h-0 min-w-0", className)}
      {...props}
    />
  );
}

/** Drag handle between panels — Codex/Harness style thin grip. */
export function ResizableHandle({
  withHandle = true,
  className,
  ...props
}: SeparatorProps & { withHandle?: boolean }) {
  return (
    <ResizablePrimitiveSeparator
      className={cn(
        "relative flex w-px shrink-0 items-center justify-center bg-border",
        "data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full",
        "hover:bg-foreground/25 data-[separator=active]:bg-foreground/40",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "data-[orientation=vertical]:cursor-col-resize data-[orientation=horizontal]:cursor-row-resize",
        className
      )}
      {...props}
    >
      {withHandle ? (
        <div
          aria-hidden
          className="z-10 flex h-8 w-3 items-center justify-center rounded-sm border border-border bg-background shadow-sm"
        >
          <div className="flex flex-col gap-[3px]">
            <span className="block h-[2px] w-[2px] rounded-full bg-muted-foreground/80" />
            <span className="block h-[2px] w-[2px] rounded-full bg-muted-foreground/80" />
            <span className="block h-[2px] w-[2px] rounded-full bg-muted-foreground/80" />
          </div>
        </div>
      ) : null}
    </ResizablePrimitiveSeparator>
  );
}
