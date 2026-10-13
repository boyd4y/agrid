import { useMatch } from "react-router-dom";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useAppShell } from "@/context/AppShellContext";
export function AiDrawer({
  onMutated,
}: {
  onMutated: (tableId?: string | null) => void;
}) {
  const { aiOpen, setAiOpen } = useAppShell();
  const tableMatch = useMatch("/app/tables/:tableId"),
    automationMatch = useMatch("/app/tables/:tableId/automations");
  const tableId = (automationMatch ?? tableMatch)?.params.tableId ?? null;
  return (
    <ChatPanel
      tableId={tableId}
      onMutated={onMutated}
      variant="drawer"
      floatingOpen={aiOpen}
      onFloatingOpenChange={setAiOpen}
    />
  );
}
