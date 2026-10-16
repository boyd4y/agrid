import { executeNativeRun as executeSharedNativeRun, type NativeRunInput, type NativeRunOutput, type NativeRunDurableOutput } from "./lifecycle.js";
import type { NativeRunServices } from "./run-services.js";
import { HTTPException } from "hono/http-exception";
import { createNativeAgent, openNativeSandbox } from "./runtime.js";
import { chatRunLimits } from "./limits.js";
import { nativeHostTools, nativeToolDenial } from "./tools.js";
import { chatErrorText, normalizeChatToolErrors } from "../ai/errors.js";
import { bindRuntimeSandbox, discardUninvokedSandbox, completeRuntimeTurn, completeUninvokedPiRun, releaseRuntimeLease, renewRuntimeLease, withRuntimeLease } from "./store.js";
import { recordRunActivity, failNativeRun, runCancellationRequested } from "./runs.js";
import { snapshotWorkspace } from "./workspace.js";
import { saveMessageInTransaction } from "../chat/store.js";
import { registerNativeRun } from "./drain.js";
import { questionContinuation } from "./questions.js";
import { parkQuestionSandbox, takeQuestionSandbox } from "./question-sandboxes.js";

export type { NativeRunInput, NativeRunOutput, NativeRunDurableOutput };

/** Assemble business services for the shared Node Harness execution lifecycle. */
export async function executeNativeRun(options: NativeRunInput, output?: NativeRunOutput, durableOutput?: NativeRunDurableOutput): Promise<void> {
  const services: NativeRunServices = {
    createNativeAgent, openNativeSandbox, nativeToolDenial, chatErrorText, normalizeChatToolErrors,
    bindRuntimeSandbox, discardUninvokedSandbox, completeRuntimeTurn, completeUninvokedPiRun, releaseRuntimeLease, renewRuntimeLease,
    recordRunActivity, failNativeRun, runCancellationRequested, snapshotWorkspace,
    registerNativeRun, questionContinuation, parkQuestionSandbox, takeQuestionSandbox,
    isOwnershipConflict: error => error instanceof HTTPException && error.status === 409,
    logger: console, limits: chatRunLimits(), pollMs: Number(process.env.AI_RUN_POLL_MS) || 2000,
    hostTools: (definitions, signal, pending) => nativeHostTools(definitions, async execute => {
      signal.throwIfAborted();
      const operation = withRuntimeLease(options.lease, async tx => { signal.throwIfAborted();return execute(tx); });
      pending.add(operation);
      try { return await operation; } finally { pending.delete(operation); }
    }, { userId: options.actor.userId, organizationId: options.actor.organizationId }),
    saveMessage: message => withRuntimeLease(options.lease, tx => saveMessageInTransaction(tx, options.lease.threadId, options.actor, message, true)),
  };
  await executeSharedNativeRun(services, options, output, durableOutput);
}
