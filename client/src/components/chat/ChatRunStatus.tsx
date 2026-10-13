import { createContext, useContext, useEffect, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { LoaderCircle } from "lucide-react";
import type { ChatActivity } from "@tabdo/shared";
import { RecoveredRunStatus } from "./ChatRuns";

export const ChatActivityContext = createContext<ReadonlyMap<string, ChatActivity>>(new Map());

const TOOL_LABELS: Record<string, string> = {
  list_tables: "查看表格列表", get_table: "读取表格", query_rows: "查询数据",
  create_table: "创建表格", add_column: "添加字段", update_column: "更新字段",
  add_row: "添加记录", update_cell: "更新单元格", update_cells: "更新数据",
  delete_row: "删除记录", delete_column: "删除字段",
  set_relation: "设置关联", add_relation: "添加关联", remove_relation: "移除关联",
  create_form_view: "创建表单", update_form_view: "更新表单",
  create_automation: "创建自动化", update_automation: "更新自动化",
  list_automations: "读取自动化", open_preview: "打开预览",
  create_goal: "保存目标", update_goal: "更新目标", update_plan: "更新计划", get_task_state: "读取任务进展",
};

/** The standard Thread remains responsible for rendering messages and cancelling. */
export function ChatRunStatus() {
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
    ? `正在${TOOL_LABELS[activity?.toolName ?? ""] ?? "执行工具"}`
    : phase === "reasoning" ? "正在思考"
    : phase === "writing" ? "正在生成回复"
    : phase === "starting" ? "正在启动智能体"
    : phase === "persisting" ? "正在保存执行结果" : "等待模型回复";
  const seconds = activity && phase ? Math.max(0, Math.floor((now - activity.updatedAt) / 1000)) : 0;
  return (
    <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground" data-testid="chat-run-status">
      <LoaderCircle className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
      <span role="status" aria-live="polite" title={phase === "tool" ? activity?.toolName : undefined}>
        {label}{phase === "waiting-model" && (activity?.completedTools ?? 0) > 0 ? "，工具已完成" : ""}
      </span>
      {seconds > 0 && <span className="ml-auto shrink-0 tabular-nums">{seconds} 秒</span>}
    </div>
  );
}
