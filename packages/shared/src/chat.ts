/** A UI projection of persisted execution state; token chunks are not events. */
export type ChatActivity = {
  threadId: string;
  runId: string;
  phase: "starting" | "waiting-model" | "reasoning" | "tool" | "writing" | "persisting" | "finished";
  step: number;
  startedAt: number;
  updatedAt: number;
  toolName?: string;
  completedTools: number;
};

export type AgentRunStatus = "starting" | "running" | "completed" | "cancelled" | "failed" | "suspended";

/** Public run projection; native session state and fencing stay on the server. */
export type AgentRunSummary = {
  id: string;
  threadId: string;
  userMessageId: string;
  assistantMessageId: string;
  status: AgentRunStatus;
  activity: ChatActivity | null;
  cancelRequestedAt: string | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  canContinue: boolean;
  /** SDK pending askUserQuestions IDs only; no native state or question inputs. */
  pendingQuestionCallIds?: string[];
};
export type AgentRunEvent = { id: string; runId: string; activity: ChatActivity; createdAt: string };
