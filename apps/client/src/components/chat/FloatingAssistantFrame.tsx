import type { ReactNode } from "react";
import { AssistantModalPrimitive } from "@assistant-ui/react";
import { useTranslation } from "react-i18next";
import { useAppShell } from "@/context/AppShellContext";
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
  const { t } = useTranslation("chat");
  const { recordSheetOpen } = useAppShell();
  if (!floating) return <>{children}</>;
  return (
    <AssistantModalPrimitive.Root
      open={open && !recordSheetOpen}
      onOpenChange={onOpenChange}
      modal={false}
      unstable_openOnRunStart={false}
    >
      <AssistantModalPrimitive.Anchor className="pointer-events-none fixed bottom-6 right-6 size-11" />
      <AssistantModalPrimitive.Content
        forceMount
        side="top"
        align="end"
        sideOffset={12}
        collisionPadding={12}
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        className="z-50 flex h-[620px] max-h-[calc(100dvh-6rem)] w-[440px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-xl data-[state=closed]:hidden"
        id="global-ai-panel"
        data-testid="global-ai-panel"
        aria-label={t("conversation")}
      >
        {children}
      </AssistantModalPrimitive.Content>
    </AssistantModalPrimitive.Root>
  );
}
