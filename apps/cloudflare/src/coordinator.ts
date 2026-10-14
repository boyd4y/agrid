import type { UIMessageChunk } from "ai";
import {
  createSessionCoordinator as createCloudflareCoordinator,
  type SessionCoordinatorRpc as GenericSessionCoordinatorRpc,
  type CoordinatorClass,
} from "@tabdo/platform-cloudflare/coordination/coordinator";
import { parseExecutionReference, type ExecutionReference, type ExecutionState, type SessionServices } from "./contracts.js";

export type SessionCoordinatorRpc = GenericSessionCoordinatorRpc<ExecutionReference, UIMessageChunk, ExecutionState>;

/** Application routing and AI UI protocol are injected into the framework's generic DO. */
export function createSessionCoordinator<Env>(services: (env: Env) => SessionServices,
  options: Readonly<{ pollIntervalMs?: number; pageSize?: number }> = {}): CoordinatorClass<Env, ExecutionReference, UIMessageChunk, ExecutionState> {
  return createCloudflareCoordinator<Env, ExecutionReference, UIMessageChunk, ExecutionState>(services, {
    parseReference: parseExecutionReference,
    scopeKeyOf: reference => reference.threadId,
    referenceFromRequest(request) {
      const url = new URL(request.url);
      return { executionId: url.searchParams.get("executionId"), runId: url.searchParams.get("runId"), threadId: url.searchParams.get("threadId") };
    },
    headers: { "connection": "keep-alive", "x-vercel-ai-ui-message-stream": "v1", "x-accel-buffering": "no" },
    openFrame: ": connected\n\n",
    errorFrame: 'data: {"type":"error","errorText":"Unable to continue the stream."}\n\n',
    endFrame: "data: [DONE]\n\n",
  }, options);
}
