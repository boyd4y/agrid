import { createHarnessAgent } from "@tabdo/platform-node/harness/agent";
import { createPiAdapter } from "@tabdo/platform-node/harness/pi";
import { createLocalSandboxAdapter } from "@tabdo/platform-node/sandbox/local";
import { tool, jsonSchema, type ToolSet, type TextStreamPart } from "ai";
import { executeNativeRun } from "@tabdo/agent-runtime/execution";
import type { NativeExecutorPorts } from "@tabdo/agent-runtime/ports";
import { createExecutionGatewayClient, GatewayError, type GatewayCredentials } from "@tabdo/agent-runtime/gateway";
import { restoreWorkspace, snapshotWorkspace } from "@tabdo/agent-runtime/workspace";
import { chatErrorText, normalizeChatToolErrors } from "@tabdo/agent-runtime/errors";
import type { HarnessAgentContinueTurnState } from "@ai-sdk/harness/agent";
import { resolveNativeConfiguration } from "@tabdo/backend/agent/runtime-configuration";

/** Native SDK execution inside the container; the only product authority is the finite gateway. */
export async function executeSandboxRun(launch: GatewayCredentials & { gatewayUrl: string }, env: Readonly<Record<string, string | undefined>>, options?: { fetch?: typeof fetch; signal?: AbortSignal }): Promise<void> {
  const client = createExecutionGatewayClient({ ...launch, fetch: options?.fetch });
  const bootstrap = await client.call("bootstrap", {});
  bootstrap.run.startedAt = new Date(bootstrap.run.startedAt);
  if (bootstrap.run.endedAt) bootstrap.run.endedAt = new Date(bootstrap.run.endedAt);
  const prepared = bootstrap.prepared;
  const definitions: ToolSet = Object.fromEntries(prepared.toolDefinitions.map(definition => [definition.name, tool({
    description: definition.description, inputSchema: jsonSchema(definition.inputSchema),
    execute: async (input, execution) => (await client.call("tool", { toolCallId: execution.toolCallId, name: definition.name, input })).result,
  })]));
  const nativeToolDenial = (value: unknown) => value && typeof value === "object" && "type" in value && value.type === "execution-denied"
    ? "reason" in value && typeof value.reason === "string" ? value.reason : "工具已关闭，无法执行" : undefined;
  const ports: NativeExecutorPorts = {
    createNativeAgent: settings => {
      if (settings.harness !== "pi") throw new Error("Cloudflare Sandbox native execution currently supports Pi; this harness is not configured");
      // Pi's local virtual filesystem lives inside this physical container.
      // A second external Sandbox is neither started nor required here.
      const configuration = resolveNativeConfiguration({ harness: "pi", mode: "local", modelId: settings.modelId, piModel: settings.piModel, env });
      if (configuration.harness !== "pi") throw new Error("Unexpected native provider configuration");
      const document = settings.agentsDocument?.trim() || "# AGENTS.md\n\n遵循 tabdo 工作区权限，使用实际工具验证结果，再向用户报告完成情况。";
      return createHarnessAgent(createPiAdapter({ ...configuration.adapter,
        onMessageEnd: settings.onPiMessageEnd, consumeContinuationInput: settings.consumePiContinuationInput,
      }), { ...settings.lifecycle, instructions: `${settings.instructions}\n\n工作区 AGENTS.md：\n${document}`, tools: settings.tools, skills: settings.skills,
        inactiveTools: settings.disabledTools, runtimeContext: settings.runtimeContext, stopWhen: settings.stopWhen,
        sandboxConfig: { workDir: "agent", onSession: async ({ session, sessionWorkDir, abortSignal }) => {
          await session.writeTextFile({ path: `${sessionWorkDir}/AGENTS.md`, content: document, abortSignal });
        } },
      });
    },
    openNativeSandbox: async settings => {
      if (settings.hasResumeState && !settings.workspace) throw new GatewayError(409, "Native workspace checkpoint is missing");
      const adapter = createLocalSandboxAdapter({ cwd: "/workspace", env: {}, createFilesystem: () => restoreWorkspace(settings.workspace), restoreFilesystem: () => restoreWorkspace(settings.workspace) });
      const request = { sandboxId: settings.sandboxId, abortSignal: settings.signal };
      const opened = settings.hasResumeState ? await adapter.resume(request) : await adapter.create(request);
      return { sandbox: opened.session, fs: opened.workspace };
    },
    hostTools: (tools, signal, pending) => {
      const failures = new Map<string, string>();
      const wrapped = Object.fromEntries(Object.entries(tools).map(([name, definition]) => [name, !definition.execute ? definition : {
        ...definition, execute: async (input: unknown, context: Parameters<NonNullable<typeof definition.execute>>[1]) => {
          signal.throwIfAborted();
          const operation = Promise.resolve().then(() => definition.execute!(input, context));
          pending.add(operation);
          try { return await operation; } catch (error) { failures.set(context.toolCallId, chatErrorText(error));throw error; }
          finally { pending.delete(operation); }
        },
      }]));
      return { tools: wrapped, failures, projectErrors: () => new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
        transform(part, controller) {
          if (part.type === "tool-result" && nativeToolDenial(part.output)) failures.set(part.toolCallId, nativeToolDenial(part.output)!);
          if ((part.type === "tool-result" || part.type === "tool-error") && failures.has(part.toolCallId))
            controller.enqueue({ type: "tool-error", toolCallId: part.toolCallId, toolName: part.toolName, input: part.input, error: failures.get(part.toolCallId)! });
          else controller.enqueue(part);
        },
      }) };
    },
    nativeToolDenial, chatErrorText, normalizeChatToolErrors, snapshotWorkspace,
    isOwnershipConflict: error => error instanceof GatewayError && [401, 403, 404, 409].includes(error.status),
    registerNativeRun: () => () => {}, logger: console,
    limits: { steps: Number(env.AI_CHAT_MAX_STEPS) || undefined, timeout: { totalMs: Number(env.AI_CHAT_TOTAL_MS) || undefined,
      stepMs: Number(env.AI_CHAT_STEP_MS) || undefined, firstChunkMs: Number(env.AI_CHAT_FIRST_CHUNK_MS) || undefined, chunkMs: Number(env.AI_CHAT_CHUNK_MS) || undefined } }, pollMs: Number(env.AI_RUN_POLL_MS) || 2000,
    questionContinuation: record => record.resumeState?.continueFrom as HarnessAgentContinueTurnState | undefined,
    // Per-Run processes end after a durable checkpoint. Resume never depends on a warm Map.
    parkQuestionSandbox: () => {}, takeQuestionSandbox: () => undefined,
    renewRuntimeLease: async () => (await client.call("renew", {})).renewed,
    releaseRuntimeLease: async () => { await client.call("release", {}); },
    runCancellationRequested: async () => (await client.call("cancelled", {})).cancelled,
    recordRunActivity: async (_lease, _runId, activity) => (await client.call("activity", { activity })).recorded,
    failNativeRun: async (_lease, _runId, error) => { await client.call("fail", { error }); },
    completeRuntimeTurn: async (_lease, _actor, _recordId, checkpoint, message, run) => {
      if (!run) throw new Error("Sandbox checkpoint must bind the accepted Run");
      await client.call("checkpoint", { checkpoint, message, status: run.status, error: run.error });
    },
    completeUninvokedPiRun: async (_lease, _actor, _recordId, message, run) => { await client.call("uninvoked", { message, status: run.status, error: run.error }); },
    saveMessage: async message => { await client.call("saveMessage", { message }); },
  };
  let failure: string | undefined;
  try {
    await executeNativeRun(ports, { actor: bootstrap.actor, lease: bootstrap.lease, record: bootstrap.record, run: bootstrap.run,
      ...prepared, tools: definitions, prompt: bootstrap.prompt, messages: bootstrap.messages, toolResultContinuations: bootstrap.toolResultContinuations,
      signal: options?.signal, metadata: bootstrap.metadata },
    undefined, { write: async chunk => { await client.call("append", { chunk }); } });
  } catch (error) { failure = chatErrorText(error);throw error; }
  finally { await client.call("settle", { error: failure }); }
}
