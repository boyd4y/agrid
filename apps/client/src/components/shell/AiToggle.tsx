import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@tabdo/ui/components/button";
import { useAppShell } from "@/context/AppShellContext";
import { APP_NAVIGATION } from "./app-navigation";
import { useMatch } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function AiToggle() {
  const { t } = useTranslation("common");
  const { aiOpen, toggleAi, recordSheetOpen } = useAppShell();
  const Icon = APP_NAVIGATION.ai.icon;
  const isAiPage = useMatch({ path: "/app", end: true });
  if (isAiPage || recordSheetOpen) return null;
  return (
    <Button
      variant={aiOpen ? "secondary" : "default"}
      onClick={toggleAi}
      className={cn(
        "fixed bottom-6 right-6 z-50 h-11 gap-2 rounded-xl border border-border px-4 shadow-md",
        !aiOpen && "border-agent/50 bg-agent text-background hover:bg-agent/90"
      )}
      aria-label={aiOpen ? t("collapseChat") : t("openChat")}
      aria-expanded={aiOpen}
      aria-controls="global-ai-panel"
      title={aiOpen ? t("collapseChatMod", { mod: "⌘" }) : t("openChatMod", { mod: "⌘" })}
      data-testid="global-ai-toggle"
    >
      {aiOpen ? <ChevronDown className="size-4" /> : <Icon className="size-4" />}
      {t("chat")}
    </Button>
  );
}
