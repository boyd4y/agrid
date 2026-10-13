import { useTranslation } from "react-i18next";
import { AutomationPanel } from "@/components/automation/AutomationPanel";
import { Loader2 } from "lucide-react";
import type { PreviewSlotContext } from "./preview-slot";

export function AutomationPreviewContent({ table, loading, error, refreshToken, active }: PreviewSlotContext) {
  const { t } = useTranslation("automation");
  return <div className="h-full min-h-0 overflow-auto p-4" data-testid="preview-slot-automations">
    {loading && !table ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("loadingEllipsis")}</p>
      : error ? <p className="text-sm text-destructive">{error}</p>
      : table ? <AutomationPanel table={table} refreshToken={refreshToken} active={active} />
      : <p className="text-sm text-muted-foreground">{t("pickOrCreateTable")}</p>}
  </div>;
}
