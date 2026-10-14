import type { ToolResultPart, UIMessage, UIMessageChunk, JSONSchema7 } from "ai";
import type { HarnessSkillDocument } from "../skills/service.js";
import type { Actor } from "../auth/actor.js";
import type { RuntimeLease, RuntimeRecord, RuntimeCheckpoint } from "./runtime-store.js";
import type { AgentRun } from "./runs.js";
import type { StoredMessage } from "../chat/store.js";
import type { ChatActivity, AgentRunStatus } from "@tabdo/shared";
import type { HarnessId } from "./contracts.js";
import type { PiModelMetadata } from "./model-contracts.js";

export type GatewayCredentials = { executionId: string; launchToken: string; token: string };
export type GatewayToolDefinition = { name: string; description?: string; inputSchema: JSONSchema7 };
export type GatewayPreparedAgent = {
  harness: HarnessId; modelId?: string; piModel?: PiModelMetadata; instructions: string;
  agentsDocument?: string; disabledTools?: readonly string[]; skills: readonly HarnessSkillDocument[];
  toolDefinitions: readonly GatewayToolDefinition[];
};
export type GatewayBootstrap = {
  actor: Actor; lease: RuntimeLease; record: RuntimeRecord; run: AgentRun;
  prepared: GatewayPreparedAgent; prompt: string; messages: UIMessage[];
  metadata: Record<string, unknown>;
  toolResultContinuations?: ToolResultPart[];
};
export type GatewayActions = {
  bootstrap: { input: Record<string, never>; output: GatewayBootstrap };
  renew: { input: Record<string, never>; output: { renewed: boolean } };
  cancelled: { input: Record<string, never>; output: { cancelled: boolean } };
  activity: { input: { activity: ChatActivity }; output: { recorded: boolean } };
  tool: { input: { toolCallId: string; name: string; input: unknown }; output: { result: unknown } };
  append: { input: { chunk: UIMessageChunk }; output: { ok: true } };
  appendBatch: { input: { chunks: readonly UIMessageChunk[] }; output: { ok: true } };
  checkpoint: { input: { checkpoint: RuntimeCheckpoint; message: StoredMessage; status: AgentRunStatus; error?: string }; output: { ok: true } };
  uninvoked: { input: { message: StoredMessage; status: "failed" | "cancelled"; error: string }; output: { ok: true } };
  saveMessage: { input: { message: StoredMessage }; output: { ok: true } };
  fail: { input: { error: string }; output: { ok: true } };
  release: { input: Record<string, never>; output: { ok: true } };
  settle: { input: { error?: string }; output: { ok: true } };
};
export type GatewayAction = keyof GatewayActions;
