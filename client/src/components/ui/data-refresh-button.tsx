import { RefreshCw } from "lucide-react";
import { Button } from "./button";
import { useTranslation } from "react-i18next";

export function DataRefreshButton({ onRefresh, disabled = false }: { onRefresh: () => void; disabled?: boolean }) {
  const { t } = useTranslation("common");
  return <Button variant="ghost" size="icon" onClick={() => onRefresh()} disabled={disabled} title={t("refresh")} aria-label={t("refresh")}><RefreshCw className="size-4" /></Button>;
}
