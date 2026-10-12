import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { NiX } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useAppShell } from "@/context/AppShellContext";
import { cn } from "@/lib/utils";

type Props = {
  onMutated: () => void;
};

const WIDTH_KEY = "agrid.aiDrawerWidth";
const MIN_W = 280;
const MAX_W = 640;
const DEFAULT_W = 380;

function readStoredWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(n)) return Math.min(MAX_W, Math.max(MIN_W, Math.round(n)));
  } catch {
    /* ignore */
  }
  return DEFAULT_W;
}

function clampWidth(n: number): number {
  return Math.min(MAX_W, Math.max(MIN_W, Math.round(n)));
}

export function AiDrawer({ onMutated }: Props) {
  const { aiOpen, setAiOpen, activeTableId } = useAppShell();
  const [width, setWidth] = useState(readStoredWidth);
  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(DEFAULT_W);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* ignore */
    }
  }, [width]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
      dragStartX.current = e.clientX;
      dragStartW.current = width;
    },
    [width]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      // Right-side panel: drag left → wider
      const next = clampWidth(dragStartW.current + (dragStartX.current - e.clientX));
      setWidth(next);
    },
    [dragging]
  );

  const endDrag = useCallback(() => {
    setDragging(false);
  }, []);

  return (
    <>
      {/* Backdrop on smaller screens */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-overlay transition-opacity lg:hidden",
          aiOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setAiOpen(false)}
        aria-hidden
      />

      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col border-l border-border bg-background shadow-[0_8px_40px_rgba(55,53,47,0.12)]",
          "lg:relative lg:z-0 lg:max-w-none lg:shadow-none",
          !dragging && "transition-[width,transform] duration-200 ease-out",
          aiOpen
            ? "translate-x-0 lg:w-[var(--ai-drawer-w)]"
            : "translate-x-full lg:w-0 lg:translate-x-0 lg:overflow-hidden lg:border-0",
          dragging && "select-none"
        )}
        style={
          {
            ["--ai-drawer-w" as string]: `${width}px`,
          } as CSSProperties
        }
        aria-hidden={!aiOpen}
      >
        {aiOpen && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整 AI 面板宽度"
              title="拖拽调整宽度"
              className={cn(
                "absolute left-0 top-0 z-10 hidden h-full w-1.5 -translate-x-1/2 cursor-col-resize touch-none lg:block",
                "hover:bg-primary/25 active:bg-primary/40",
                dragging && "bg-primary/40"
              )}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-muted/80 px-3 lg:hidden">
              <span className="text-sm font-medium text-foreground">
                AI 助手
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setAiOpen(false)}
                title="关闭"
              >
                <NiX className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <ChatPanel tableId={activeTableId} onMutated={onMutated} />
            </div>
          </>
        )}
      </aside>
    </>
  );
}
