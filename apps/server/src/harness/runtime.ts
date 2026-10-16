import type { HarnessV1NetworkSandboxSession, HarnessV1Skill } from "@ai-sdk/harness";
import type { ToolSet } from "ai";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mapServiceError } from "../services/dependencies.js";
import type { RuntimeProvider } from "@tabdo/shared";
import { createRailwaySandboxAdapter } from "@tabdo/agent-runtime/sandbox/railway";
import { assertRuntimeProviderAvailable, resolveRuntimeProvider } from "../business/agent/sandbox-configuration.js";
import type { DiskWorkspace } from "@tabdo/agent-runtime/sandbox/workspace";
import { createHarnessAgent } from "@tabdo/agent-runtime/harness/agent";
import { type HarnessAdapter, type NativeAgent, type NativeAgentSettings } from "@tabdo/agent-runtime/harness/types";
import { createPiAdapter } from "@tabdo/agent-runtime/harness/pi";
import { createCodexAdapter } from "@tabdo/agent-runtime/harness/codex";
import { createClaudeCodeAdapter } from "@tabdo/agent-runtime/harness/claude-code";
import { createLocalSandboxAdapter } from "@tabdo/agent-runtime/sandbox/local";
import { createVercelSandboxAdapter } from "@tabdo/agent-runtime/sandbox/vercel";
import { HTTPException } from "hono/http-exception";
import { restoreWorkspace, type WorkspaceSnapshot } from "./workspace.js";
import type { HarnessId } from "../ai/model.js";
import type { PiModelMetadata, PiCompletion } from "./model-contracts.js";
import { validateDisabledTools } from "./tool-settings.js";
export type { NativeAgent, NativeAgentSettings };

export type { RuntimeMode } from "./contracts.js";
import type { RuntimeMode, RuntimeEnvironment as Environment } from "./contracts.js";
import { resolveNativeConfiguration, sandboxCredentials } from "./runtime-configuration.js";

/** Construct the official runtime, never a model-only or offline rules fallback. */
export function createNativeAgent(options: {
  harness: HarnessId;
  mode: RuntimeMode;
  provider?: RuntimeProvider;
  modelId?: string;
  piModel?: PiModelMetadata;
  instructions: string;
  agentsDocument?: string;
  tools: ToolSet;
  disabledTools?: readonly string[];
  skills: readonly HarnessV1Skill[];
  runtimeContext?: Record<string, unknown>;
  env?: Environment;
  lifecycle?: Pick<NativeAgentSettings, "onStart" | "onStepStart" | "onLanguageModelCallStart" | "onLanguageModelCallEnd" | "onToolExecutionStart" | "onToolExecutionEnd" | "onStepEnd" | "onEnd">;
  stopWhen?: NativeAgentSettings["stopWhen"];
  onPiMessageEnd?: (completion: PiCompletion) => void;
  consumePiContinuationInput?: () => string | undefined;
}): NativeAgent {
  const env = options.env ?? process.env;
  const configuration = resolveNativeConfiguration({ ...options, env });
  const adapter: HarnessAdapter = configuration.harness === "pi"
    ? createPiAdapter({ ...configuration.adapter, onMessageEnd: options.onPiMessageEnd, consumeContinuationInput: options.consumePiContinuationInput })
    : configuration.harness === "codex" ? createCodexAdapter(configuration.adapter) : createClaudeCodeAdapter(configuration.adapter);

  const document =
    options.agentsDocument?.trim() ||
    "# AGENTS.md\n\n遵循 tabdo 工作区权限，使用实际工具验证结果，再向用户报告完成情况。";
  return createHarnessAgent(adapter, {
    ...options.lifecycle,
    tools: options.tools,
    inactiveTools: validateDisabledTools(options.harness, options.disabledTools),
    skills: options.skills,
    runtimeContext: options.runtimeContext,
    stopWhen: options.stopWhen,
    instructions: `${options.instructions}\n\n工作区 AGENTS.md：\n${document}`,
    sandboxConfig: {
      workDir: "agent",
      onSession: async ({ session, sessionWorkDir, abortSignal }) => {
        await session.writeTextFile({
          path: `${sessionWorkDir}/AGENTS.md`,
          content: document,
          abortSignal,
        });
      },
    },
  });
}

/** A resumed local Pi gets its isolated filesystem back; remote sandboxes use SDK lookup. */
export async function openNativeSandbox(options: {
  agent: NativeAgent;
  mode: RuntimeMode;
  provider?: RuntimeProvider;
  sandboxId: string;
  hasResumeState: boolean;
  sandboxCreated?: boolean;
  workspace?: WorkspaceSnapshot | null;
  signal?: AbortSignal;
  env?: Environment;
}): Promise<{ sandbox: HarnessV1NetworkSandboxSession; fs?: DiskWorkspace }> {
  const env = options.env ?? process.env;
  const provider = options.provider ?? resolveRuntimeProvider(options.mode, undefined, env);
  if ((options.mode === "local") !== (provider === "local")) throw new HTTPException(409, { message: "运行提供商与模式不匹配" });
  try { assertRuntimeProviderAvailable(provider, env, options.agent.harnessId); } catch (error) { return mapServiceError(error); }
  const localEnvironment: Record<string, string> = {
    ...(env.LOCAL_SANDBOX_NPM_REGISTRY ? { npm_config_registry: env.LOCAL_SANDBOX_NPM_REGISTRY } : {}),
    ...(env.LOCAL_SANDBOX_HTTPS_PROXY ? { HTTPS_PROXY: env.LOCAL_SANDBOX_HTTPS_PROXY } : {}),
  };
  if (provider === "local" && options.agent.harnessId !== "pi") {
    const adapter = createLocalSandboxAdapter({ cwd: "/workspace", env: localEnvironment,
      storageDirectory: env.LOCAL_SANDBOX_DIRECTORY || join(tmpdir(), "tabdo-local-sandboxes") });
    const opened = options.hasResumeState || options.sandboxCreated
      ? await adapter.resume({ sandboxId: options.sandboxId, abortSignal: options.signal })
      : await adapter.create({ sandboxId: options.sandboxId, template: await options.agent.getSandboxTemplate(), abortSignal: options.signal });
    // Leave installed native dependencies and journals on the same disk. Their
    // paths stay opaque and stable across API/worker processes on this host.
    return { sandbox: opened.session };
  }
  if (provider === "local") {
    if (options.hasResumeState && !options.workspace)
      throw new HTTPException(409, {
        message: "本地原生工作区快照缺失，无法恢复；请新建对话",
      });
    const adapter = createLocalSandboxAdapter({ cwd: "/workspace", env: localEnvironment,
      createFilesystem: () => restoreWorkspace(options.workspace),
      restoreFilesystem: () => restoreWorkspace(options.workspace),
    });
    const request = { sandboxId: options.sandboxId, abortSignal: options.signal };
    const opened = options.hasResumeState ? await adapter.resume(request) : await adapter.create({ ...request, template: await options.agent.getSandboxTemplate() });
    return { sandbox: opened.session, fs: opened.workspace };
  }

  const adapter = provider === "e2b" ? (await import("@tabdo/agent-runtime/sandbox/e2b")).createE2BSandboxAdapter({ apiKey: env.E2B_API_KEY!, template: env.E2B_TEMPLATE,
    timeoutMs: env.E2B_TIMEOUT_MS ? Number(env.E2B_TIMEOUT_MS) : undefined })
    : provider === "railway" ? createRailwaySandboxAdapter({ token: env.RAILWAY_API_TOKEN!, environmentId: env.RAILWAY_SANDBOX_ENVIRONMENT_ID!,
      checkpoint: env.RAILWAY_SANDBOX_CHECKPOINT, region: env.RAILWAY_SANDBOX_REGION,
      idleTimeoutMinutes: env.RAILWAY_SANDBOX_IDLE_MINUTES ? Number(env.RAILWAY_SANDBOX_IDLE_MINUTES) : undefined })
    : createVercelSandboxAdapter({ create: { ...sandboxCredentials(env), runtime: "node24", ports: [4000] }, resume: sandboxCredentials(env) });
  const opened = options.hasResumeState || options.sandboxCreated
    ? await adapter.resume({ sandboxId: options.sandboxId, abortSignal: options.signal })
    : await adapter.create({ ...(provider === "vercel" ? { sandboxId: options.sandboxId } : {}),
      template: await options.agent.getSandboxTemplate(), abortSignal: options.signal });
  return { sandbox: opened.session };
}
