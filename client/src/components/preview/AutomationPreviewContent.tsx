import { AutomationPanel } from "@/components/automation/AutomationPanel";
import { Loader2 } from "lucide-react";
import type { PreviewSlotContext } from "./preview-slot";

export function AutomationPreviewContent({ table, loading, error, refreshToken, active }: PreviewSlotContext) {
  return <div className="h-full min-h-0 overflow-auto p-4" data-testid="preview-slot-automations">
    {loading && !table ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />加载中…</p>
      : error ? <p className="text-sm text-destructive">{error}</p>
      : table ? <AutomationPanel table={table} refreshToken={refreshToken} active={active} />
      : <p className="text-sm text-muted-foreground">请选择或创建表格，查看和配置自动化。</p>}
  </div>;
}
