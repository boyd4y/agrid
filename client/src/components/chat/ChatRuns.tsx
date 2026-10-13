import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { Play, RefreshCw, Square } from "lucide-react";
import type { AgentRunSummary, AgentRunStatus, ChatActivity } from "@tabdo/shared";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const RUN_LABELS: Record<AgentRunStatus, string> = { starting: "启动中", running: "执行中", completed: "已完成", cancelled: "已停止", failed: "失败", suspended: "已暂停" };
export const isActiveRun = (run?: AgentRunSummary) => run?.status === "starting" || run?.status === "running";
export function activityLabel(activity?: ChatActivity | null): string {
  if (!activity) return "正在启动智能体";
  return ({ starting: "正在启动智能体", "waiting-model": "等待模型回复", reasoning: "正在思考", tool: `执行工具 ${activity.toolName ?? ""}`, writing: "正在生成回复", persisting: "正在保存执行结果", finished: "执行结果已保存" })[activity.phase];
}
type RunState = { threadId?: string; runs: AgentRunSummary[]; error: string | null; loading: boolean; refresh: () => void; stop: (run: AgentRunSummary) => Promise<void>; resume: (run: AgentRunSummary) => Promise<void>; pending: boolean };
export const ChatRunsContext = createContext<RunState>({ runs: [], error: null, loading: false, refresh: () => {}, stop: async () => {}, resume: async () => {}, pending: false });

/** Explicit stop survives closing the transport; server execution has its own lifetime. */
export function PersistentRunCancel() {
  const aui = useAui();
  const { refresh } = useContext(ChatRunsContext);
  const [pending, setPending] = useState(false);
  const cancel = async () => {
    if (pending) return;
    setPending(true);
    try {
      const itemId = aui.threadListItem.getState().id;
      const item = aui.threads.item({ id: itemId });
      const threadId = item.getState().remoteId ?? (await item.initialize()).remoteId;
      if (threadId) {
        const deadline = Date.now() + 5000;
        // Submission can precede the durable claim. Observe it before closing
        // the transport, so early Stop cannot leave a newly claimed Run alive.
        do {
          const { runs } = await api.listAgentRuns(threadId);
          const active = runs.find(isActiveRun);
          if (active) { await api.cancelAgentRun(threadId, active.id); break; }
          if (!aui.thread.getState().isRunning && !aui.thread.getState().composer.submission) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        } while (Date.now() < deadline);
      }
      if (aui.threadListItem.getState().id === itemId) aui.thread.cancelRun();
      refresh();
    } catch (failure) { toast.error(failure instanceof Error ? failure.message : "停止失败，请重试"); }
    finally { setPending(false); }
  };
  return <Button variant="default" size="icon" className="size-7 rounded-full" aria-label="Stop generating" disabled={pending} onClick={() => void cancel()}><Square /></Button>;
}

/** Observe durable execution. Importing persisted UI messages never starts a model or tools. */
export function ChatRunsProvider({ children, onRecovered }: PropsWithChildren<{ onRecovered: () => void }>) {
  const aui = useAui();
  const threadId = useAuiState((s) => s.threadListItem.remoteId);
  const running = useAuiState((s) => s.thread.isRunning);
  const [snapshot, setSnapshot] = useState<{ threadId?: string; runs: AgentRunSummary[] }>({ runs: [] });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const imported = useRef<string | null>(null);
  const observed = useRef<string | null>(null);
  const onRecoveredRef = useRef(onRecovered); onRecoveredRef.current = onRecovered;
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => { setSnapshot({ threadId, runs: [] }); setError(null); imported.current = null; observed.current = null; }, [threadId]);
  useEffect(() => {
    if (!threadId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      setLoading(true);
      let active = false;
      try {
        const { runs } = await api.listAgentRuns(threadId, controller.signal);
        if (controller.signal.aborted) return;
        setSnapshot({ threadId, runs }); setError(null);
        const latest = runs[0]; active = isActiveRun(latest);
        if (active) observed.current = latest.id;
        const thread = aui.thread.getState();
        if (latest && !active && !thread.isRunning && !thread.isLoading && imported.current !== latest.id
          && (observed.current === latest.id || !thread.messages.some((m) => m.id === latest.assistantMessageId))) {
          const history = await api.getChatMessages(threadId, controller.signal);
          if (controller.signal.aborted || aui.threadListItem.getState().remoteId !== threadId || aui.thread.getState().isRunning) return;
          aui.thread.importExternalState({ headId: history.headId ?? undefined, messages: history.messages.filter((m) => m.format === "ai-sdk/v6").map((m) => ({ parentId: m.parentId, message: { ...m.content, id: m.id } })) });
          imported.current = latest.id;
          if (observed.current === latest.id) onRecoveredRef.current();
          observed.current = null;
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "无法同步当前执行状态");
      } finally {
        if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(() => void load(), active || running ? 2000 : 8000); }
      }
    };
    void load();
    const focus = () => refresh(); window.addEventListener("focus", focus);
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener("focus", focus); };
  }, [threadId, running, revision, aui, refresh]);
  const stop = async (run: AgentRunSummary) => {
    if (pending || !isActiveRun(run)) return;
    setPending(true);
    try { await api.cancelAgentRun(run.threadId, run.id); refresh(); }
    catch (failure) { toast.error(failure instanceof Error ? failure.message : "停止失败"); }
    finally { setPending(false); }
  };
  const resume = async (run: AgentRunSummary) => {
    if (pending || running || !run.canContinue) return;
    setPending(true);
    try {
      const { runs } = await api.listAgentRuns(run.threadId);
      if (aui.threadListItem.getState().remoteId !== run.threadId || runs[0]?.id !== run.id || !runs[0].canContinue) throw new Error("执行状态已变化，请刷新查看");
      const history = await api.getChatMessages(run.threadId);
      if (aui.threadListItem.getState().remoteId !== run.threadId || aui.thread.getState().isRunning) return;
      aui.thread.importExternalState({ headId: history.headId ?? undefined, messages: history.messages.filter((m) => m.format === "ai-sdk/v6").map((m) => ({ parentId: m.parentId, message: { ...m.content, id: m.id } })) });
      aui.thread.append("继续执行");
    } catch (failure) { toast.error(failure instanceof Error ? failure.message : "继续失败"); }
    finally { setPending(false); refresh(); }
  };
  return <ChatRunsContext.Provider value={{ threadId, runs: snapshot.threadId === threadId ? snapshot.runs : [], error, loading, refresh, stop, resume, pending }}>{children}</ChatRunsContext.Provider>;
}

function RunActions({ run }: { run: AgentRunSummary }) {
  const { pending, stop, resume } = useContext(ChatRunsContext);
  const running = useAuiState((s) => s.thread.isRunning);
  return <>
    {isActiveRun(run) && <Button variant="outline" size="sm" disabled={pending || Boolean(run.cancelRequestedAt)} onClick={() => void stop(run)} data-testid="agent-run-stop"><Square data-icon="inline-start" />{run.cancelRequestedAt ? "正在停止…" : "停止执行"}</Button>}
    {run.canContinue && <Button variant="outline" size="sm" disabled={pending || running} onClick={() => void resume(run)} data-testid="agent-run-resume"><Play data-icon="inline-start" />继续执行</Button>}
  </>;
}
export function RecoveredRunStatus() {
  const { runs, error, refresh } = useContext(ChatRunsContext);
  const running = useAuiState((s) => s.thread.isRunning);
  const latest = runs[0];
  if (running || !latest || (!isActiveRun(latest) && !latest.canContinue)) return null;
  return <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-muted-foreground" data-testid="recovered-run-status"><span role="status" aria-live="polite" className={cn("min-w-0 flex-1", error && "text-destructive")}>{error ? "无法同步执行状态" : isActiveRun(latest) ? activityLabel(latest.activity) : `${RUN_LABELS[latest.status]}，可继续剩余步骤`}</span>{error ? <Button size="sm" variant="ghost" onClick={refresh}>重试</Button> : <RunActions run={latest} />}</div>;
}
