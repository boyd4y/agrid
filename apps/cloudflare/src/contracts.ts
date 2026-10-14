import type { UIMessageChunk } from "ai";
import {
  CoordinationError,
  type AccessCredentials as Credentials,
  type OutputRequest as GenericOutputRequest,
  type OutputPage as GenericOutputPage,
  type SessionServices as GenericSessionServices,
} from "@tabdo/platform-cloudflare/coordination/contracts";
export { CoordinationError, parseCursor, type TriggerServices } from "@tabdo/platform-cloudflare/coordination/contracts";

/** Product references remain application data, never an authenticated principal. */
export type ExecutionReference = Readonly<{ executionId: string; runId: string; threadId: string }>;
export type AccessCredentials = Credentials;
export type OutputRequest = GenericOutputRequest<ExecutionReference>;
export type ExecutionState = "accepted" | "invoking" | "settled";
export type OutputPage = GenericOutputPage<UIMessageChunk, ExecutionState>;
export type SessionServices = GenericSessionServices<ExecutionReference, UIMessageChunk, ExecutionState>;

export function parseExecutionReference(value: unknown): ExecutionReference {
  if (!value || typeof value !== "object") throw new CoordinationError("Invalid execution reference", 400);
  const source = value as Record<string, unknown>;
  for (const key of ["executionId", "runId", "threadId"] as const) {
    if (typeof source[key] !== "string" || !source[key] || source[key].length > 256) {
      throw new CoordinationError("Invalid execution reference", 400);
    }
  }
  return Object.freeze({ executionId: source.executionId as string, runId: source.runId as string, threadId: source.threadId as string });
}
