import type { HarnessV1NetworkSandboxSession, HarnessV1Skill } from "@ai-sdk/harness";
import type { ToolSet } from "ai";
import type { InMemoryFs } from "just-bash";
import { createHarnessAgent } from "@tabdo/harness/agent";
import { assertSandboxCompatibility, type HarnessAdapter, type NativeAgent, type NativeAgentSettings } from "@tabdo/harness";
import { createPiAdapter } from "@tabdo/harness/adapters/pi";
import { createCodexAdapter } from "@tabdo/harness/adapters/codex";
import { createClaudeCodeAdapter } from "@tabdo/harness/adapters/claude-code";
import { createLocalSandboxAdapter } from "@tabdo/sandbox/adapters/local";
import { createVercelSandboxAdapter } from "@tabdo/sandbox/adapters/vercel";
import { HTTPException } from "hono/http-exception";
import { restoreWorkspace, type WorkspaceSnapshot } from "./workspace.js";
import type { HarnessId } from "../ai/model.js";
import { DEFAULT_PI_OUTPUT_TOKENS, type PiModelMetadata, type PiCompletion } from "./model-metadata.js";
import { validateDisabledTools } from "./tool-catalog.js";
export type { NativeAgent, NativeAgentSettings };

export type RuntimeMode = "local" | "sandbox";
type Environment = Readonly<Record<string, string | undefined>>;
const value = (env: Environment, name: string) =>
  env[name]?.trim() || undefined;

function sandboxCredentials(env: Environment) {
  const token = value(env, "VERCEL_TOKEN"),
    teamId = value(env, "VERCEL_TEAM_ID"),
    projectId = value(env, "VERCEL_PROJECT_ID");
  if (token && teamId && projectId) return { token, teamId, projectId };
  if (value(env, "VERCEL_OIDC_TOKEN")) return {};
  throw new HTTPException(503, {
    message:
      "Sandbox 未配置：需要 VERCEL_TOKEN、VERCEL_TEAM_ID、VERCEL_PROJECT_ID，或部署环境的 VERCEL_OIDC_TOKEN",
  });
}

/** Construct the official runtime, never a model-only or offline rules fallback. */
export function createNativeAgent(options: {
  harness: HarnessId;
  mode: RuntimeMode;
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
  if (options.mode === "local" && options.harness !== "pi")
    throw new HTTPException(400, {
      message:
        "本地模式目前支持 Pi；Codex 和 Claude Code 需要可暴露端口的 Sandbox 模式",
    });
  if (options.mode === "sandbox") sandboxCredentials(env);

  let adapter: HarnessAdapter, model: string | undefined;
  if (options.harness === "pi") {
    const openRouterKey = value(env, "OPENROUTER_API_KEY"),
      directKey = value(env, "PI_API_KEY");
    const directBase = value(env, "PI_BASE_URL");
    if (!openRouterKey && !(directKey && directBase))
      throw new HTTPException(503, {
        message:
          "Pi 未配置模型提供商：请设置 OPENROUTER_API_KEY，或 PI_API_KEY 与 PI_BASE_URL",
      });
    const provider = openRouterKey ? "openrouter" : "tabdo-pi";
    const modelId =
      options.modelId?.trim() ||
      value(env, "PI_MODEL") ||
      (openRouterKey
        ? value(env, "OPENROUTER_MODEL") || "openrouter/free"
        : undefined);
    if (!modelId)
      throw new HTTPException(400, {
        message: "自定义 Pi 提供商需要配置模型 ID",
      });
    const maxTokens = options.piModel?.maxTokens ?? (Number(env.PI_MAX_OUTPUT_TOKENS) || DEFAULT_PI_OUTPUT_TOKENS);
    const maxTokensField = openRouterKey ? "max_tokens" : "max_completion_tokens";
    adapter = createPiAdapter({
      providerId: provider,
      baseUrl: openRouterKey ? value(env, "OPENROUTER_BASE_URL") || "https://openrouter.ai/api/v1" : directBase!,
      apiKey: openRouterKey || directKey!,
      model: { id: modelId, reasoning: options.piModel?.reasoning ?? false,
        contextWindow: options.piModel?.contextWindow ?? (Number(env.PI_CONTEXT_WINDOW) || 32768), maxTokens },
      maxTokensField,
      samplingParams: openRouterKey ? { reasoning: { enabled: false, effort: "none" } } : undefined,
      // Current warm-session behavior is preserved until platform cold resume is wired.
      reattachInProcess: true,
      onMessageEnd: options.onPiMessageEnd,
      consumeContinuationInput: options.consumePiContinuationInput,
    });
  } else if (options.harness === "codex") {
    const key = value(env, "OPENAI_API_KEY") || value(env, "CODEX_API_KEY");
    if (!key)
      throw new HTTPException(503, {
        message:
          "原生 Codex 需要 OPENAI_API_KEY 或 CODEX_API_KEY，并按 Responses 协议配置；当前适配器不会自动复用 OPENROUTER_API_KEY",
      });
    const base = value(env, "OPENAI_BASE_URL") || value(env, "CODEX_BASE_URL");
    model = options.modelId?.trim() || value(env, "CODEX_MODEL");
    if (model === "openrouter/free" || model === "openrouter/auto")
      throw new HTTPException(400, {
        message: "Codex 需要原生模型 ID，请重新设置智能体模型",
      });
    adapter = createCodexAdapter({ apiKey: key, baseUrl: base, model });
  } else {
    const key = value(env, "ANTHROPIC_API_KEY") || value(env, "CLAUDE_API_KEY");
    if (!key)
      throw new HTTPException(503, {
        message:
          "原生 Claude Code 需要 ANTHROPIC_API_KEY 或 CLAUDE_API_KEY；请配置 Anthropic Messages 协议提供商",
      });
    const base = value(env, "ANTHROPIC_BASE_URL");
    model = options.modelId?.trim() || value(env, "CLAUDE_MODEL");
    if (model === "openrouter/free" || model === "openrouter/auto")
      throw new HTTPException(400, {
        message: "Claude Code 需要原生模型 ID，请重新设置智能体模型",
      });
    adapter = createClaudeCodeAdapter({ apiKey: key, baseUrl: base, model });
  }

  const document =
    options.agentsDocument?.trim() ||
    "# AGENTS.md\n\n遵循 tabdo 工作区权限，使用实际工具验证结果，再向用户报告完成情况。";
  assertSandboxCompatibility(adapter, options.mode === "sandbox");
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
  sandboxId: string;
  hasResumeState: boolean;
  workspace?: WorkspaceSnapshot | null;
  signal?: AbortSignal;
  env?: Environment;
}): Promise<{ sandbox: HarnessV1NetworkSandboxSession; fs?: InMemoryFs }> {
  if (options.mode === "local") {
    if (options.hasResumeState && !options.workspace)
      throw new HTTPException(409, {
        message: "本地原生工作区快照缺失，无法恢复；请新建对话",
      });
    const adapter = createLocalSandboxAdapter({ cwd: "/workspace", env: {},
      createFilesystem: () => restoreWorkspace(options.workspace),
      restoreFilesystem: () => restoreWorkspace(options.workspace),
    });
    const request = { sandboxId: options.sandboxId, abortSignal: options.signal };
    const opened = options.hasResumeState ? await adapter.resume(request) : await adapter.create(request);
    return { sandbox: opened.session, fs: opened.workspace };
  }

  const credentials = sandboxCredentials(options.env ?? process.env);
  const adapter = createVercelSandboxAdapter({
    create: { ...credentials, runtime: "node24", ports: [4000] },
    resume: credentials,
  });
  const opened = options.hasResumeState
    ? await adapter.resume({ sandboxId: options.sandboxId, abortSignal: options.signal })
    : await adapter.create({ sandboxId: options.sandboxId, template: await options.agent.getSandboxTemplate(), abortSignal: options.signal });
  return { sandbox: opened.session };
}
