import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAppShell } from "@/context/AppShellContext";
import { APP_NAVIGATION } from "./app-navigation";
import { useMatch } from "react-router-dom";

export function AiToggle() {
  const { aiOpen, toggleAi, recordSheetOpen } = useAppShell();
  const Icon = APP_NAVIGATION.ai.icon;
  const isAiPage = useMatch({ path: "/app", end: true });
  if (isAiPage) return null;
  return (
    <Button
      variant={aiOpen ? "secondary" : "default"}
      onClick={toggleAi}
      className={cn(
        "fixed bottom-6 right-6 z-50 h-11 gap-2 rounded-full border border-border px-4 shadow-md",
        recordSheetOpen && "left-6 right-auto lg:left-auto lg:right-[calc(480px+1.5rem)]"
      )}
      aria-label={aiOpen ? "收起 AI 助手" : "打开 AI 助手"}
      aria-expanded={aiOpen}
      aria-controls="global-ai-panel"
      title={aiOpen ? "收起 AI 助手 ⌘J" : "打开 AI 助手 ⌘J"}
      data-testid="global-ai-toggle"
    >
      {aiOpen ? <ChevronDown className="size-4" /> : <Icon className="size-4" />}
      AI
    </Button>
  );
}
