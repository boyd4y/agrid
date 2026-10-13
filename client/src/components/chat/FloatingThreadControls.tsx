import { useAui } from "@assistant-ui/react";
import { History, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
export function FloatingThreadControls({
  showThreads,
  onShowThreads,
  onClose,
}: {
  showThreads: boolean;
  onShowThreads: (show: boolean) => void;
  onClose?: () => void;
}) {
  const aui = useAui();
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={showThreads ? "返回聊天" : "历史对话"}
        aria-pressed={showThreads}
        onClick={() => onShowThreads(!showThreads)}
        title="历史对话"
        data-testid="floating-thread-toggle"
      >
        <History className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label="新对话"
        title="新对话"
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
        aria-label="收起 AI 助手"
        title="收起 AI 助手"
        onClick={onClose}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
