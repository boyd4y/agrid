import { createContext, useContext, useEffect, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatActivity } from "@tabdo/shared";
import i18n from "@/i18n";
import { RecoveredRunStatus } from "./ChatRuns";

export const ChatActivityContext = createContext<ReadonlyMap<string, ChatActivity>>(new Map());

const TOOL_KEYS = [
  "batch_add_rows",
  "batch_update_rows",
  "batch_delete_rows",
  "batch_add_columns",
  "batch_update_columns",
  "batch_delete_columns",
  "batch_set_relations",
  "batch_add_relations",
  "batch_remove_relations",

  "list_tables", "get_table", "query_rows", "create_table", "add_column", "update_column",
  "add_row", "update_cell", "update_cells", "delete_row", "delete_column",
  "set_relation", "add_relation", "remove_relation", "create_form_view", "update_form_view",
  "create_automation", "update_automation", "list_automations", "open_preview",
  "create_goal", "update_goal", "update_plan", "get_task_state",
] as const;

function toolLabel(name: string | undefined): string {
  if (name && (TOOL_KEYS as readonly string[]).includes(name)) {
    return i18n.t(`chat:tools.${name}`);
  }
  return i18n.t("chat:executingTool");
}

/** The standard Thread remains responsible for rendering messages and cancelling. */
export function ChatRunStatus() {
  const { t } = useTranslation("chat");
  const running = useAuiState((s) => s.thread.isRunning);
  const remoteId = useAuiState((s) => s.threadListItem.remoteId);
  const activities = useContext(ChatActivityContext);
  const activity = remoteId ? activities.get(remoteId) : undefined;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, activity?.runId, activity?.updatedAt]);
  if (!running) return <RecoveredRunStatus />;

  const phase = activity?.phase === "finished" ? undefined : activity?.phase;
  const label = phase === "tool"
    ? t("runningTool", { tool: toolLabel(activity?.toolName) })
    : phase === "reasoning" ? t("phase.reasoning")
    : phase === "writing" ? t("phase.writing")
    : phase === "starting" ? t("phase.starting")
    : phase === "persisting" ? t("phase.persisting") : t("phase.waitingModel");
  const seconds = activity && phase ? Math.max(0, Math.floor((now - activity.updatedAt) / 1000)) : 0;
  return (
    <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground" data-testid="chat-run-status">
      <LoaderCircle className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
      <span role="status" aria-live="polite" title={phase === "tool" ? activity?.toolName : undefined}>
        {label}{phase === "waiting-model" && (activity?.completedTools ?? 0) > 0 ? t("toolsDone") : ""}
      </span>
      {seconds > 0 && <span className="ml-auto shrink-0 tabular-nums">{t("seconds", { n: seconds })}</span>}
    </div>
  );
}
