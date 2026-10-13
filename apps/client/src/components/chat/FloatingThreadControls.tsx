import { useAui } from "@assistant-ui/react";
import { History, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@tabdo/ui/components/button";
export function FloatingThreadControls({
  showThreads,
  onShowThreads,
  onClose,
}: {
  showThreads: boolean;
  onShowThreads: (show: boolean) => void;
  onClose?: () => void;
}) {
  const { t } = useTranslation("chat");
  const aui = useAui();
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={showThreads ? t("backToChat") : t("history")}
        aria-pressed={showThreads}
        onClick={() => onShowThreads(!showThreads)}
        title={t("history")}
        data-testid="floating-thread-toggle"
      >
        <History className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={t("newChat")}
        title={t("newChat")}
        onClick={() => {
          aui.threads.switchToNewThread();
          onShowThreads(false);
        }}
        data-testid="floating-new-thread"
      >
        <Plus className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={t("collapseChat")}
        title={t("collapseChat")}
        onClick={onClose}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
