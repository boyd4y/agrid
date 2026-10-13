import { RefreshCw } from "lucide-react";
import { Button } from "./button";

export function DataRefreshButton({ onRefresh, disabled = false }: { onRefresh: () => void; disabled?: boolean }) {
  return <Button variant="ghost" size="icon" onClick={() => onRefresh()} disabled={disabled} title="刷新数据" aria-label="刷新数据"><RefreshCw className="size-4" /></Button>;
}
