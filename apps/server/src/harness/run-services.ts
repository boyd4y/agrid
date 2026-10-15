import type { ToolSet, TextStreamPart } from "ai";
import type { HarnessV1Skill, HarnessV1NetworkSandboxSession } from "@ai-sdk/harness";
import type { HarnessAgentContinueTurnState } from "@ai-sdk/harness/agent";
import type { NativeAgent, NativeAgentSettings } from "@tabdo/agent-runtime/harness/types";
import type { DiskWorkspace } from "@tabdo/agent-runtime/sandbox/workspace";
import type { Actor } from "../business/auth/actor.js";
import type { RuntimeLease, RuntimeRecord, RuntimeCheckpoint } from "../business/agent/runtime-store.js";
import type { StoredMessage } from "../business/chat/store.js";
import type { AgentRunStatus, ChatActivity } from "@tabdo/shared";
import type { WorkspaceSnapshot } from "../business/agent/checkpoints.js";
import type { HarnessId } from "../business/agent/contracts.js";
import type { PiModelMetadata, PiCompletion } from "../business/agent/model-contracts.js";

export type { HarnessId, PiModelMetadata, PiCompletion };
type WarmSandbox = { sandbox: HarnessV1NetworkSandboxSession; fs?: DiskWorkspace; discard(): Promise<void> };

/** Business persistence and tool services used by the Node Harness lifecycle. */
export interface NativeRunServices {
  createNativeAgent(options: {
    harness: HarnessId; mode: "local" | "sandbox"; modelId?: string; piModel?: PiModelMetadata;
    instructions: string; agentsDocument?: string; tools: ToolSet; disabledTools?: readonly string[];
    skills: readonly HarnessV1Skill[]; runtimeContext?: Record<string, unknown>;
    lifecycle?: Pick<NativeAgentSettings, "onStart" | "onStepStart" | "onLanguageModelCallStart" | "onLanguageModelCallEnd" | "onToolExecutionStart" | "onToolExecutionEnd" | "onStepEnd" | "onEnd">;
    stopWhen?: NativeAgentSettings["stopWhen"];
    onPiMessageEnd?: (completion: PiCompletion) => void;
    consumePiContinuationInput?: () => string | undefined;
  }): NativeAgent;
  openNativeSandbox(options: { agent: NativeAgent; mode: "local" | "sandbox"; sandboxId: string; hasResumeState: boolean; workspace?: WorkspaceSnapshot | null; signal?: AbortSignal }): Promise<{ sandbox: HarnessV1NetworkSandboxSession; fs?: DiskWorkspace }>;
  hostTools(definitions: ToolSet, signal: AbortSignal, pending: Set<Promise<unknown>>): { tools: ToolSet; failures: Map<string, string>; projectErrors(): TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>> };
  nativeToolDenial(output: unknown): string | undefined;
  chatErrorText(error: unknown): string;
  normalizeChatToolErrors(): TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>;
  isOwnershipConflict(error: unknown): boolean;
  registerNativeRun(): () => void;
  logger: Pick<Console, "warn" | "error">;
  limits: { steps?: number; timeout: { totalMs?: number; stepMs?: number; firstChunkMs?: number; chunkMs?: number } };
  pollMs?: number;
  questionContinuation(record: RuntimeRecord): HarnessAgentContinueTurnState | undefined;
  parkQuestionSandbox(runtimeId: string, opened: WarmSandbox): void;
  takeQuestionSandbox(runtimeId: string): WarmSandbox | undefined;
  snapshotWorkspace(fs: DiskWorkspace): Promise<WorkspaceSnapshot>;
  renewRuntimeLease(lease: RuntimeLease): Promise<boolean>;
  releaseRuntimeLease(lease: RuntimeLease): Promise<void>;
  runCancellationRequested(runId: string): Promise<boolean>;
  recordRunActivity(lease: RuntimeLease, runId: string, activity: ChatActivity): Promise<boolean>;
  failNativeRun(lease: RuntimeLease, runId: string, error: string): Promise<void>;
  completeRuntimeTurn(lease: RuntimeLease, actor: Actor, recordId: string, checkpoint: RuntimeCheckpoint, message: StoredMessage, run?: { id: string; status: AgentRunStatus; error?: string }): Promise<void>;
  completeUninvokedPiRun(lease: RuntimeLease, actor: Actor, recordId: string, message: StoredMessage, run: { id: string; status: "failed" | "cancelled"; error: string }): Promise<void>;
  saveMessage(message: StoredMessage): Promise<void>;
}
