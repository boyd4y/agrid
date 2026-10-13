import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { Play, Square } from "lucide-react";
import type { AgentRunSummary, AgentRunStatus, ChatActivity } from "@tabdo/shared";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import i18n from "@/i18n";
import { useTranslation } from "react-i18next";

export function runStatusLabel(status: AgentRunStatus): string {
  return i18n.t(`chat:runStatus.${status}`);
}
/** @deprecated Prefer runStatusLabel — kept for external imports that expect a map. */
export const RUN_LABELS: Record<AgentRunStatus, string> = new Proxy({} as Record<AgentRunStatus, string>, {
  get: (_t, prop: string) => runStatusLabel(prop as AgentRunStatus),
});
export const isActiveRun = (run?: AgentRunSummary) => run?.status === "starting" || run?.status === "running";
export function activityLabel(activity?: ChatActivity | null): string {
  if (!activity) return i18n.t("chat:phase.starting");
  if (activity.phase === "tool") return i18n.t("chat:executingToolNamed", { name: activity.toolName ?? "" });
  const map = {
    starting: "chat:phase.starting",
    "waiting-model": "chat:phase.waitingModel",
    reasoning: "chat:phase.reasoning",
    writing: "chat:phase.writing",
    persisting: "chat:phase.persisting",
    finished: "chat:phase.finished",
  } as const;
  return i18n.t(map[activity.phase]);
}
type RunState = { threadId?: string; runs: AgentRunSummary[]; error: string | null; loading: boolean; refresh: () => void; stop: (run: AgentRunSummary) => Promise<void>; resume: (run: AgentRunSummary) => Promise<void>; pending: boolean };
export const ChatRunsContext = createContext<RunState>({ runs: [], error: null, loading: false, refresh: () => {}, stop: async () => {}, resume: async () => {}, pending: false });

/** Explicit stop survives closing the transport; server execution has its own lifetime. */
export function PersistentRunCancel() {
  const { t } = useTranslation("chat");
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
    } catch (failure) { toast.error(failure instanceof Error ? failure.message : i18n.t("chat:stopFailedRetry")); }
    finally { setPending(false); }
  };
  return <Button variant="default" size="icon" className="size-7 rounded-full" aria-label={t("stopGenerating")} disabled={pending} onClick={() => void cancel()}><Square /></Button>;
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
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : i18n.t("chat:syncRunFailed"));
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
    catch (failure) { toast.error(failure instanceof Error ? failure.message : i18n.t("chat:stopFailed")); }
    finally { setPending(false); }
  };
  const resume = async (run: AgentRunSummary) => {
    if (pending || running || !run.canContinue) return;
    setPending(true);
    try {
      const { runs } = await api.listAgentRuns(run.threadId);
      if (aui.threadListItem.getState().remoteId !== run.threadId || runs[0]?.id !== run.id || !runs[0].canContinue) throw new Error(i18n.t("chat:runStateChanged"));
      const history = await api.getChatMessages(run.threadId);
      if (aui.threadListItem.getState().remoteId !== run.threadId || aui.thread.getState().isRunning) return;
      aui.thread.importExternalState({ headId: history.headId ?? undefined, messages: history.messages.filter((m) => m.format === "ai-sdk/v6").map((m) => ({ parentId: m.parentId, message: { ...m.content, id: m.id } })) });
      aui.thread.append(i18n.t("chat:resumePrompt"));
    } catch (failure) { toast.error(failure instanceof Error ? failure.message : i18n.t("chat:resumeFailed")); }
    finally { setPending(false); refresh(); }
  };
  return <ChatRunsContext.Provider value={{ threadId, runs: snapshot.threadId === threadId ? snapshot.runs : [], error, loading, refresh, stop, resume, pending }}>{children}</ChatRunsContext.Provider>;
}

function RunStopButton({ run, pending, stop }: { run: AgentRunSummary; pending: boolean; stop: (run: AgentRunSummary) => Promise<void> }) {
  const { t } = useTranslation("chat");
  return <Button variant="outline" size="sm" disabled={pending || Boolean(run.cancelRequestedAt)} onClick={() => void stop(run)} data-testid="agent-run-stop"><Square data-icon="inline-start" />{run.cancelRequestedAt ? t("stopping") : t("stopRun")}</Button>;
}
function RunResumeButton({ run, pending, running, resume }: { run: AgentRunSummary; pending: boolean; running: boolean; resume: (run: AgentRunSummary) => Promise<void> }) {
  const { t } = useTranslation("chat");
  return <Button variant="outline" size="sm" disabled={pending || running} onClick={() => void resume(run)} data-testid="agent-run-resume"><Play data-icon="inline-start" />{t("resumeRun")}</Button>;
}
function RunActions({ run }: { run: AgentRunSummary }) {
  const { pending, stop, resume } = useContext(ChatRunsContext);
  const running = useAuiState((s) => s.thread.isRunning);
  return <>
    {isActiveRun(run) && <RunStopButton run={run} pending={pending} stop={stop} />}
    {run.canContinue && <RunResumeButton run={run} pending={pending} running={running} resume={resume} />}
  </>;
}
export function RecoveredRunStatus() {
  const { t } = useTranslation(["chat", "common"]);
  const { runs, error, refresh } = useContext(ChatRunsContext);
  const running = useAuiState((s) => s.thread.isRunning);
  const latest = runs[0];
  if (running || !latest || (!isActiveRun(latest) && !latest.canContinue)) return null;
  const statusText = error
    ? t("syncRunFailedShort")
    : isActiveRun(latest)
      ? activityLabel(latest.activity)
      : t("canContinueSteps", { status: runStatusLabel(latest.status) });
  return <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-muted-foreground" data-testid="recovered-run-status"><span role="status" aria-live="polite" className={cn("min-w-0 flex-1", error && "text-destructive")}>{statusText}</span>{error ? <Button size="sm" variant="ghost" onClick={refresh}>{t("common:retry")}</Button> : <RunActions run={latest} />}</div>;
}
