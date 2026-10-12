import { NiX } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useAppShell } from "@/context/AppShellContext";
import { cn } from "@/lib/utils";

type Props = {
  onMutated: () => void;
};

export function AiDrawer({ onMutated }: Props) {
  const { aiOpen, setAiOpen, activeTableId } = useAppShell();

  return (
    <>
      {/* Backdrop on smaller screens */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-[rgba(55,53,47,0.18)] transition-opacity lg:hidden",
          aiOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setAiOpen(false)}
        aria-hidden
      />

      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col border-l border-border bg-background shadow-[0_8px_40px_rgba(55,53,47,0.12)] transition-transform duration-200 ease-out",
          "lg:static lg:z-0 lg:max-w-none lg:shadow-none",
          aiOpen
            ? "translate-x-0 lg:w-[380px]"
            : "translate-x-full lg:w-0 lg:translate-x-0 lg:overflow-hidden lg:border-0"
        )}
        aria-hidden={!aiOpen}
      >
        {aiOpen && (
          <>
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
