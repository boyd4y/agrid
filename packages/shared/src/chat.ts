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
};
export type AgentRunEvent = { id: string; runId: string; activity: ChatActivity; createdAt: string };

export type AgentPlanStep = { text: string; status: "pending" | "in_progress" | "completed" };
export type AgentGoal = { objective: string; status: "active" | "paused" | "complete" | "cancelled"; progress: string };
/** Public projection. Native resume state, sandbox identifiers and files stay private. */
export type AgentTaskState = {
  plan: AgentPlanStep[];
  goal: AgentGoal | null;
  mode: "local" | "sandbox";
  updatedAt: string;
};
