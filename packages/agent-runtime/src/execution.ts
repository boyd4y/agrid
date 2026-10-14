import { toUIMessageStream, stepCountIs, type TextStreamPart, type ToolResultPart, type ToolSet, type UIMessage, type UIMessageChunk } from "ai";
import type { HarnessAgentSession, HarnessAgentResumeSessionState } from "@ai-sdk/harness/agent";
import type { HarnessV1NetworkSandboxSession, HarnessV1Skill } from "@ai-sdk/harness";
import type { InMemoryFs } from "just-bash";
import type { Actor } from "@tabdo/backend/auth/actor";
import type { RuntimeRecord, RuntimeLease } from "@tabdo/backend/agent/runtime-store";
import type { AgentRun } from "@tabdo/backend/agent/runs";
import type { ChatActivity, AgentRunStatus } from "@tabdo/shared";
import type { NativeExecutorPorts, PiModelMetadata, PiCompletion, HarnessId } from "./ports.js";
import { QUESTION_NOT_INVOKED } from "@tabdo/backend/checkpoints";

function hasSavedPiJournal(record: RuntimeRecord): boolean {
  if (!record.resumeState) return true;
  const name = (record.resumeState.data as { sessionFileName?: unknown })?.sessionFileName;
  if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.jsonl?$/.test(name)) return false;
  if (record.mode === "sandbox") return true; // Remote lookup still must succeed before invocation.
  const file = record.workspace?.find((entry) => entry.type === "file" && entry.path.endsWith(`/${name}`));
  if (!file?.content) return false;
  try {
    const decoded = atob(file.content);
    if (btoa(decoded) !== file.content) return false;
    const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
    const entries = new TextDecoder().decode(bytes).trim().split("\n").map((line) => JSON.parse(line));
    return entries.length > 1 && entries[0]?.type === "session";
  } catch { return false; }
}

/** Product execution input; no HTTP request or response owns this lifetime. */
export type NativeRunInput = {
  actor: Actor;
  lease: RuntimeLease;
  record: RuntimeRecord;
  run: AgentRun;
  harness: HarnessId;
  modelId?: string;
  piModel?: PiModelMetadata;
  instructions: string;
  agentsDocument?: string;
  tools: ToolSet;
  disabledTools?: readonly string[];
  skills: readonly HarnessV1Skill[];
  prompt: string;
  messages: UIMessage[];
  signal?: AbortSignal;
  metadata: Record<string, unknown>;
  toolResultContinuations?: ToolResultPart[];
};

/** Ephemeral projection, not a durable event log or authority for cancellation. */
export interface NativeRunOutput {
  write(chunk: UIMessageChunk): void;
}

/** Durable projection append participates in execution lifetime and backpressure. */
export interface NativeRunDurableOutput {
  write(chunk: UIMessageChunk): Promise<void>;
}

/** Await native completion, atomic checkpoint persistence and lease cleanup. */
export async function executeNativeRun(ports: NativeExecutorPorts, options: NativeRunInput, output?: NativeRunOutput, durableOutput?: NativeRunDurableOutput): Promise<void> {
  let delivery = output, outputFailed = false;
  let outputWrites: Promise<void> = Promise.resolve();
  // SDK lifecycle callbacks and the projection reader can emit concurrently.
  // One chain preserves publication order and bounds in-flight durable appends.
  const writer = { write(chunk: UIMessageChunk): Promise<void> {
    const operation = outputWrites.then(async () => {
      try { await durableOutput?.write(chunk); }
      catch (error) {
        outputFailed = true;errorText = ports.chatErrorText(error);control.abort(error);
        throw error;
      }
      try { delivery?.write(chunk); }
      catch {
        // A closed ephemeral transport cannot cancel an accepted operation.
        delivery = undefined;
        ports.logger.warn("agent.projection.detached");
      }
    });
    outputWrites = operation;
    return operation;
  } };
  const releaseNativeRun = ports.registerNativeRun();
  const control = new AbortController();
  const signal = AbortSignal.any([control.signal, ...(options.signal ? [options.signal] : [])]);
  let session: HarnessAgentSession | undefined, sandbox: HarnessV1NetworkSandboxSession | undefined, fs: InMemoryFs | undefined;
  let agent: ReturnType<NativeExecutorPorts["createNativeAgent"]> | undefined;
  let step = options.toolResultContinuations ? options.run.activity?.step ?? 0 : 0, completedTools = options.toolResultContinuations ? options.run.activity?.completedTools ?? 0 : 0, activity: ChatActivity | undefined, errorText: string | undefined;
  let parkedQuestion = false;
  let piCompletion: PiCompletion | undefined;
  let piContinuationInput: string | undefined;
  let streamedStep = 0, modelActive = false, expectedOutputStep = 1;
  let cancelled = false, timedOut = false, lostLease = false, closed = false;
  // Set before calling the SDK, not from callbacks or completed-tool counts.
  let invocationStarted = false, projectionStarted = false;
  let safeStartupState = options.harness === "pi" && hasSavedPiJournal(options.record);
  let timeoutReason = "本轮执行超时";
  let stepDeadline: ReturnType<typeof setTimeout> | undefined;
  let firstOutputDeadline: ReturnType<typeof setTimeout> | undefined;
  let chunkDeadline: ReturnType<typeof setTimeout> | undefined;
  let heartbeatBusy = false, lastRenewal = Date.now();
  let phaseWrites = Promise.resolve();
  const pendingTools = new Set<Promise<unknown>>();
  const activeTools = new Map<string, string>();
  const limits = ports.limits;
  const abortTimeout = (reason: string) => {
    if (signal.aborted) return;
    timedOut = true;timeoutReason = reason;control.abort(new DOMException(reason, "TimeoutError"));
  };
  const deadline = (ms: number | undefined, reason: string) => ms === undefined ? undefined : setTimeout(() => abortTimeout(reason), ms);
  // Harness 1.0.149 discards the inherited streamText timeout option.
  // Use its official lifecycle/stream events to bound the AbortSignal instead.
  const timeout = deadline(limits.timeout.totalMs, "本轮执行超时");
  const clearModelDeadlines = () => { clearTimeout(firstOutputDeadline);clearTimeout(chunkDeadline); };
  const waitForModelOutput = (nextStep: number) => {
    clearModelDeadlines();modelActive = true;expectedOutputStep = nextStep;
    firstOutputDeadline = deadline(limits.timeout.firstChunkMs, "模型首个输出等待超时");
  };
  const modelOutput = () => {
    if (!modelActive || streamedStep !== expectedOutputStep) return;
    clearTimeout(firstOutputDeadline);clearTimeout(chunkDeadline);
    chunkDeadline = deadline(limits.timeout.chunkMs, "模型输出流超时");
  };
  const pollMs = Math.max(200, Math.min(10_000, ports.pollMs ?? 2000));
  const pollCancellation = async () => {
    try {
      if (await ports.runCancellationRequested(options.run.id)) { cancelled = true;control.abort(new DOMException("用户停止执行", "AbortError")); }
    } catch (error) {
      if (ports.isOwnershipConflict(error)) { lostLease = true;errorText = ports.chatErrorText(error);control.abort(error); }
      else ports.logger.warn("agent.cancel.poll", ports.chatErrorText(error));
    }
  };
  const heartbeat = setInterval(async () => {
    if (closed || heartbeatBusy) return;
    heartbeatBusy = true;
    try {
      await pollCancellation();
      if (Date.now() - lastRenewal >= 15_000) {
        if (!await ports.renewRuntimeLease(options.lease)) { lostLease = true;control.abort(new Error("运行已被其他实例接管")); }
        lastRenewal = Date.now();
      }
    } catch (error) { errorText = ports.chatErrorText(error);control.abort(error); }
    finally { heartbeatBusy = false; }
  }, pollMs);

  const report = (phase: ChatActivity["phase"], toolName?: string) => {
    if (activity?.phase === phase && activity.toolName === toolName && activity.step === step && activity.completedTools === completedTools) return phaseWrites;
    activity = { threadId: options.lease.threadId, runId: options.run.id, phase, step, startedAt: options.run.startedAt.getTime(), updatedAt: Date.now(), toolName, completedTools };
    const update = activity;
    phaseWrites = phaseWrites.then(async () => {
      if (!await ports.recordRunActivity(options.lease, options.run.id, update)) return;
      await writer.write({ type: "data-chat-activity", data: update, transient: true });
    }).catch((error) => {
      if (ports.isOwnershipConflict(error)) { errorText = ports.chatErrorText(error);lostLease = true;control.abort(error); }
      else ports.logger.warn("agent.activity.sync", ports.chatErrorText(error));
    });
    return phaseWrites;
  };
  const { tools, projectErrors, failures } = ports.hostTools(options.tools, signal, pendingTools);
  const lifecycle: NonNullable<Parameters<NativeExecutorPorts["createNativeAgent"]>[0]["lifecycle"]> = {
    onStart: async () => { await report("waiting-model"); },
    onStepStart: async ({ stepNumber }) => { clearTimeout(stepDeadline);stepDeadline = deadline(limits.timeout.stepMs, "本轮步骤执行超时");step = stepNumber + 1;await report("waiting-model"); },
    onLanguageModelCallStart: async () => { waitForModelOutput(step);await report("waiting-model"); },
    onLanguageModelCallEnd: () => { modelActive = false;clearModelDeadlines(); },
    onToolExecutionStart: async ({ toolCall }) => { modelActive = false;clearModelDeadlines();activeTools.set(toolCall.toolCallId, toolCall.toolName);await report("tool", toolCall.toolName); },
    onToolExecutionEnd: async ({ toolCall, toolOutput }) => {
      activeTools.delete(toolCall.toolCallId);
      if (toolOutput.type === "tool-result" && !ports.nativeToolDenial(toolOutput.output) && !failures.has(toolCall.toolCallId)) completedTools++;
      const remaining = activeTools.values().next().value;
      await report(remaining ? "tool" : "waiting-model", remaining);
    },
    onStepEnd: async ({ toolResults }) => {
      modelActive = false;clearTimeout(stepDeadline);clearModelDeadlines();
      for (const result of toolResults) {
        if (failures.has(result.toolCallId) || ports.nativeToolDenial(result.output)) continue;
        if (!/^(create_|update_|rename_|add_|batch_|delete_|set_|remove_|reorder_|move_card)/.test(result.toolName)) continue;
        const output = result.output as { affectedTableIds?: string[]; tableId?: string; id?: string } | undefined;
        const ids = output?.affectedTableIds ?? (output?.tableId ? [output.tableId] : result.toolName === "create_table" && output?.id ? [output.id] : undefined);
        if (ids?.length === 0) continue;
        await writer.write({ type: "data-table-mutated", data: { tableIds: ids }, transient: true });
      }
      // Pi reports the next model lifecycle only once it has output. Bound
      // the wait between native steps as well as the visible output stream.
      if (toolResults.length) {
        waitForModelOutput(step + 1);
        stepDeadline = deadline(limits.timeout.stepMs, "本轮步骤执行超时");
      }
    },
  };

  const cleanup = async () => {
    try {
      closed = true;clearTimeout(timeout);clearInterval(heartbeat);clearTimeout(stepDeadline);clearModelDeadlines();
      await Promise.allSettled([...pendingTools]);
      await phaseWrites;
      // Pi stop before its first native turn may return data:{}; never commit it.
      if (session && !invocationStarted) await session.stop().catch((error) => ports.logger.error("agent.session.cleanup", ports.chatErrorText(error)));
      if (sandbox && !parkedQuestion) await Promise.resolve(sandbox.stop()).catch((error) => ports.logger.error("agent.sandbox.stop", ports.chatErrorText(error)));
      await ports.releaseRuntimeLease(options.lease);
    } finally { releaseNativeRun(); }
  };
  const persist = async (message: UIMessage, status: AgentRunStatus) => {
    await Promise.allSettled([...pendingTools]);
    await phaseWrites;
    await report("persisting");
    if (!session) throw new Error("原生会话未能启动");
    // The SDK alone decides when a client tool needs a result. Detach
    // captures its official continuation without stopping a waiting bridge.
    const resumeState = session.hasUnfinishedTurn() ? await session.detach() : await session.stop();
    const workspace = fs ? await ports.snapshotWorkspace(fs) : null;
    if (options.harness === "pi" && !hasSavedPiJournal({ ...options.record, resumeState, workspace }))
      throw new Error("会话结果未完整保存，历史消息已保留；请新建对话继续。");
    // Pi's native stop saves its own journal. Missing it must not become empty history on reload.
    if (fs && !fs.getAllPaths().some((path) => path.endsWith(".jsonl"))) throw new Error("原生会话日志未保存，不能继续此对话；请核对已完成的数据修改");
    const { id, ...content } = message;
    await ports.completeRuntimeTurn(options.lease, options.actor, options.record.id, {
      resumeState, workspace, sandboxId: sandbox!.id,
      userMessageId: options.run.userMessageId, assistantMessageId: id,
      status: status === "completed" ? "ready" : status === "failed" ? "failed" : "interrupted", error: errorText,
    }, { id, parentId: options.run.userMessageId, format: "ai-sdk/v6", content }, { id: options.run.id, status, error: errorText });
    if (status === "suspended" && ports.questionContinuation({ ...options.record, resumeState })) {
      const questionAgent = agent!, questionSandbox = sandbox!;
      ports.parkQuestionSandbox(options.record.id, { sandbox: questionSandbox, fs, discard: async () => {
        // A detached handle cannot be destroyed. Recreate through the SDK
        // without invoking a turn, then discard its native parked runtime.
        try {
          const discarded = await questionAgent.createSession({ sessionId: options.record.sessionId, sandboxSession: questionSandbox, resumeFrom: resumeState, abortSignal: signal });
          await discarded.destroy();
        } finally {
          await questionSandbox.destroy();
        }
      } });
      parkedQuestion = true;
    }
    await report("finished");
  };
  const startupFailure = async (error: unknown) => {
    errorText = ports.chatErrorText(error);
    cancelled ||= Boolean(options.signal?.aborted) && !timedOut;
    if (options.toolResultContinuations) {
      // The original turn already executed. Answers were committed before
      // continuation, so an SDK startup error must neither erase them nor
      // certify this entire turn as uninvoked. Do not replay or fake a reply.
      const status = cancelled || options.signal?.aborted ? "cancelled" : "failed";
      const message = options.messages.at(-1)!;
      if (session && invocationStarted) {
        try { await persist(message, status); }
        catch (checkpointError) { errorText = ports.chatErrorText(checkpointError);await ports.failNativeRun(options.lease, options.run.id, errorText); }
      } else {
        const { id, ...originalContent } = message;
        const previousMetadata = originalContent.metadata && typeof originalContent.metadata === "object" && !Array.isArray(originalContent.metadata)
          ? originalContent.metadata as Record<string, unknown> : {};
        const content = !invocationStarted ? { ...originalContent, metadata: { ...previousMetadata,
          nativeQuestionInvocation: { proof: QUESTION_NOT_INVOKED, runId: options.run.id, fence: options.lease.fence,
            toolCallIds: options.toolResultContinuations.map(result => result.toolCallId).sort() },
        } } : originalContent;
        await ports.completeRuntimeTurn(options.lease, options.actor, options.record.id, {
          resumeState: options.record.resumeState as HarnessAgentResumeSessionState, workspace: options.record.workspace,
          sandboxId: options.record.sandboxId!, userMessageId: options.run.userMessageId, assistantMessageId: id,
          status: status === "cancelled" ? "interrupted" : "failed", error: errorText,
        }, { id, parentId: options.run.userMessageId, format: "ai-sdk/v6", content }, { id: options.run.id, status, error: errorText });
        await report("finished");
      }
      await writer.write(status === "cancelled" ? { type: "abort" } : { type: "error", errorText });
      return;
    }
    const uninvoked = !invocationStarted && safeStartupState;
    const text = cancelled ? "" : uninvoked ? `系统提示：本轮未能启动：${errorText}。本轮没有执行操作，可以重新发送消息。`
      : `系统提示：本轮未能完成：${errorText}。已提交的数据修改会保留。`;
    const message: UIMessage = { id: options.run.assistantMessageId, role: "assistant", parts: text ? [{ type: "text", text }] : [] };
    if (uninvoked) {
      await phaseWrites;
      await ports.completeUninvokedPiRun(options.lease, options.actor, options.record.id,
        { id: message.id, parentId: options.run.userMessageId, format: "ai-sdk/v6", content: { role: "assistant", parts: message.parts } },
        { id: options.run.id, status: cancelled ? "cancelled" : "failed", error: errorText });
      await report("finished");
    } else if (session && invocationStarted) {
      try { await persist(message, cancelled ? "cancelled" : "failed"); }
      catch (checkpointError) { errorText = ports.chatErrorText(checkpointError);await ports.failNativeRun(options.lease, options.run.id, errorText); }
    } else {
      await ports.saveMessage({ id: message.id, parentId: options.run.userMessageId, format: "ai-sdk/v6", content: { role: "assistant", parts: message.parts } });
      await ports.failNativeRun(options.lease, options.run.id, errorText);
      await report("finished");
    }
    await writer.write({ type: "start", messageId: message.id });
    if (!text) { await writer.write({ type: "abort" }); return; }
    await writer.write({ type: "text-start", id: "run-error" });
    await writer.write({ type: "text-delta", id: "run-error", delta: text });
    await writer.write({ type: "text-end", id: "run-error" });
    await writer.write({ type: "finish" });
  };

  try {
    await report("starting");
    signal.throwIfAborted();
    if (options.harness === "pi" && options.record.resumeState && !safeStartupState)
      throw new Error("此对话暂时无法继续，历史消息已保留；请新建对话继续。");
    agent = ports.createNativeAgent({ harness: options.harness, mode: options.record.mode, modelId: options.modelId, piModel: options.piModel,
      instructions: options.instructions, agentsDocument: options.agentsDocument, tools, disabledTools: options.disabledTools, skills: options.skills, lifecycle,
      runtimeContext: { organizationId: options.actor.organizationId, threadId: options.lease.threadId, runId: options.run.id },
      stopWhen: limits.steps === undefined ? undefined : stepCountIs(limits.steps),
      onPiMessageEnd: (completion) => { piCompletion = completion; },
      consumePiContinuationInput: () => {
        const text = piContinuationInput;
        piContinuationInput = undefined;
        return text;
      },
    });
    let opened: Awaited<ReturnType<NativeExecutorPorts["openNativeSandbox"]>>;
    try { opened = (options.toolResultContinuations ? ports.takeQuestionSandbox(options.record.id) : undefined)
      ?? await ports.openNativeSandbox({ agent, mode: options.record.mode, sandboxId: options.record.sandboxId, hasResumeState: Boolean(options.record.resumeState), workspace: options.record.workspace, signal }); }
    catch (error) {
      // Local restore failures describe damaged history, not a retryable submission.
      if (options.record.resumeState && options.record.mode === "local" && !signal.aborted) safeStartupState = false;
      throw error;
    }
    sandbox = opened.sandbox;fs = opened.fs;
    try { session = await agent.createSession({ sessionId: options.record.sessionId, sandboxSession: sandbox, abortSignal: signal,
      ...(options.record.resumeState ? { resumeFrom: options.record.resumeState as HarnessAgentResumeSessionState } : {}),
    }); } catch (error) {
      // A resumed session that fails SDK validation/start is not proven intact.
      if (options.record.resumeState && !signal.aborted) safeStartupState = false;
      throw error;
    }
    const continuing = session.hasUnfinishedTurn();
    if (continuing && options.harness === "pi" && !options.toolResultContinuations) piContinuationInput = options.prompt;
    waitForModelOutput(1);
    stepDeadline = deadline(limits.timeout.stepMs, "本轮步骤执行超时");
    await pollCancellation();
    signal.throwIfAborted();
    invocationStarted = true;
    const result = continuing ? await agent.continueStream({ session, abortSignal: signal, toolResultContinuations: options.toolResultContinuations }) : await agent.stream({ session, prompt: options.prompt, abortSignal: signal });
    if (continuing && options.harness !== "pi" && !options.toolResultContinuations) {
      // Bridge-backed adapters accept fresh input through their official
      // prompt-control API, including the bridge's accepted acknowledgement.
      // Never replace a new user message with a magic continuation keyword.
      try { await agent.experimental_steer({ session, text: options.prompt }); }
      catch (error) { control.abort(error);throw error; }
    }
    let terminalWritten = false;
    const terminalText = (controller: TransformStreamDefaultController<TextStreamPart<ToolSet>>, text: string) => {
      terminalWritten = true;
      controller.enqueue({ type: "text-start", id: "run-note" });
      controller.enqueue({ type: "text-delta", id: "run-note", text: `\n\n系统提示：${text}` });
      controller.enqueue({ type: "text-end", id: "run-note" });
    };
    const stream = result.stream.pipeThrough(projectErrors()).pipeThrough(ports.normalizeChatToolErrors()).pipeThrough(new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
      async transform(part, controller) {
        if (part.type === "start-step") streamedStep++;
        if (["text-delta", "reasoning-delta", "tool-input-delta"].includes(part.type)) modelOutput();
        if (part.type === "text-delta" && part.text.trim()) await report("writing");
        if (part.type === "reasoning-delta") await report("reasoning");
        if (part.type === "finish" || part.type === "abort" || part.type === "error") { modelActive = false;clearModelDeadlines();clearTimeout(stepDeadline); }
        if (part.type === "error") errorText = ports.chatErrorText(part.error);
        if (part.type === "abort") {
          cancelled ||= Boolean(options.signal?.aborted) && !timedOut;
          errorText ||= timedOut ? timeoutReason : lostLease ? "运行已被接管" : "已停止执行";
          if (!terminalWritten && (!cancelled || timedOut || lostLease)) terminalText(controller, `${errorText}。已完成的工具结果会保留。`);
        }
        if (part.type === "error" && !terminalWritten && (!cancelled || timedOut || lostLease)) terminalText(controller, `本轮未能完成：${errorText}。已完成的工具结果会保留。`);
        if (part.type === "finish" && piCompletion?.finishReason === "length" && !terminalWritten) {
          const usage = piCompletion.outputTokens ? `（${piCompletion.outputTokens} token${piCompletion.reasoningTokens ? `，其中推理 ${piCompletion.reasoningTokens}` : ""}）` : "";
          errorText = `本轮达到模型输出上限${usage}，回答尚未完成`;
          terminalText(controller, `${errorText}。已生成的内容和工具结果已保留。`);
        }
        // A natural native stop can contain tools/reasoning without prose.
        // Do not invent a failure or an assistant summary for that result.
        controller.enqueue(part);
      },
    }));
    projectionStarted = true;
    const output = toUIMessageStream({ stream, tools: agent.tools, originalMessages: options.messages,
      generateMessageId: () => options.run.assistantMessageId, onError: ports.chatErrorText,
      messageMetadata: ({ part }) => part.type === "finish-step" ? { ...options.metadata, runId: options.run.id, ...(piCompletion ? { completion: piCompletion } : {}) } : undefined,
      onFinish: async ({ responseMessage, outcome, isCancelled }) => {
        try {
          if (isCancelled && !outputFailed) { cancelled = true;control.abort(new DOMException("客户端停止执行", "AbortError")); }
          const status: AgentRunStatus = cancelled || options.signal?.aborted ? "cancelled" : errorText || timedOut || lostLease || outcome.status === "failed" ? "failed" : session!.hasUnfinishedTurn() ? "suspended" : "completed";
          await persist(responseMessage, status);
        } catch (error) {
          errorText = ports.chatErrorText(error);
          await ports.failNativeRun(options.lease, options.run.id, errorText).catch(() => {});
          throw error;
        } finally { await cleanup(); }
      },
    });
    const reader = output.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
    } catch (error) {
      // Durable delivery failure stops native work and asks the official SDK to
      // save its partial projection/checkpoint. It is not a user cancellation.
      if (outputFailed) await reader.cancel(error).catch(() => {});
      throw error;
    } finally { reader.releaseLock(); }
  } catch (error) {
    // onFinish already persisted or failed the invoked turn and cleaned up.
    // A projection/checkpoint failure must not run startup handling a second time.
    if (projectionStarted) {
      if (!closed) {
        // A malformed/erroring SDK stream can bypass its onFinish callback.
        // Record an executed failure, never certify it as an uninvoked retry.
        try { await ports.failNativeRun(options.lease, options.run.id, ports.chatErrorText(error)); }
        finally { await cleanup(); }
      }
      throw error;
    }
    try { await startupFailure(error); } finally { await cleanup(); }
  }
}
