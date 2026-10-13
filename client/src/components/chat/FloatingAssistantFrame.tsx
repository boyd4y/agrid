import type { ReactNode } from "react";
import { AssistantModalPrimitive } from "@assistant-ui/react";
import { useAppShell } from "@/context/AppShellContext";
import { cn } from "@/lib/utils";
export function FloatingAssistantFrame({
  floating,
  open,
  onOpenChange,
  children,
}: {
  floating: boolean;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const { recordSheetOpen } = useAppShell();
  if (!floating) return <>{children}</>;
  return (
    <AssistantModalPrimitive.Root
      open={open}
      onOpenChange={onOpenChange}
      modal={false}
      unstable_openOnRunStart={false}
    >
      <AssistantModalPrimitive.Anchor className={cn("pointer-events-none fixed bottom-6 right-6 size-11", recordSheetOpen && "lg:right-[calc(480px+1.5rem)]")} />
      <AssistantModalPrimitive.Content
        forceMount
        side="top"
        align="end"
        sideOffset={12}
        collisionPadding={12}
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        className="z-50 flex h-[620px] max-h-[calc(100dvh-6rem)] w-[440px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-background text-foreground shadow-xl data-[state=closed]:hidden"
        id="global-ai-panel"
        data-testid="global-ai-panel"
        aria-label="AI 助手"
      >
        {children}
      </AssistantModalPrimitive.Content>
    </AssistantModalPrimitive.Root>
  );
}
