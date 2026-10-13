import { RefreshCw } from "lucide-react";
import { Button } from "./button";

export function DataRefreshButton({ onRefresh, disabled = false, label = "Refresh" }: { onRefresh: () => void; disabled?: boolean; label?: string }) {
  return <Button variant="ghost" size="icon" onClick={() => onRefresh()} disabled={disabled} title={label} aria-label={label}><RefreshCw className="size-4" /></Button>;
}
