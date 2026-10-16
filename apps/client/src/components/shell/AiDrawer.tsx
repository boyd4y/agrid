import { useMatch, useNavigate } from "react-router-dom";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useAppShell } from "@/context/AppShellContext";
export function AiDrawer({
  onMutated,
}: {
  onMutated: (tableId?: string | null) => void;
}) {
  const navigate = useNavigate();
  const { aiOpen, setAiOpen } = useAppShell();
  const tableMatch = useMatch("/app/tables/:tableId"),
    automationMatch = useMatch("/app/tables/:tableId/automations");
  const tableId = (automationMatch ?? tableMatch)?.params.tableId ?? null;
  return (
    <ChatPanel
      tableId={tableId}
      onOpenPreview={payload => { if (payload.kind === "site" && payload.siteId && payload.open !== false) navigate(`/app/sites/${payload.siteId}`); }}
      onMutated={onMutated}
      variant="drawer"
      floatingOpen={aiOpen}
      onFloatingOpenChange={setAiOpen}
    />
  );
}
