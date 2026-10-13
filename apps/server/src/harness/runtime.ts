import { HarnessAgent, type HarnessAgentSettings } from "@ai-sdk/harness/agent";
import type {
  HarnessV1,
  HarnessV1NetworkSandboxSession,
  HarnessV1Skill,
} from "@ai-sdk/harness";
import { createPi } from "@ai-sdk/harness-pi";
import { createCodex } from "@ai-sdk/harness-codex";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import { createJustBashNetworkSandboxSession } from "@ai-sdk/sandbox-just-bash";
import {
  createVercelNetworkSandboxSession,
  resumeVercelNetworkSandboxSession,
} from "@ai-sdk/sandbox-vercel";
import type { ToolSet } from "ai";
import type { InMemoryFs } from "just-bash";
import { HTTPException } from "hono/http-exception";
import { restoreWorkspace, type WorkspaceSnapshot } from "./workspace.js";
import type { HarnessId } from "../ai/model.js";
import { DEFAULT_PI_OUTPUT_TOKENS, type PiModelMetadata, type PiCompletion } from "./model-metadata.js";
import { validateDisabledTools } from "./tool-catalog.js";

export type RuntimeMode = "local" | "sandbox";
type Environment = Readonly<Record<string, string | undefined>>;
export type NativeAgent = HarnessAgent<HarnessV1, ToolSet>;
export type NativeAgentSettings = HarnessAgentSettings<HarnessV1, ToolSet>;
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

  let harness: HarnessV1, model: string | undefined;
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
    harness = createPi({
      // An explicit environment disables native subscription discovery on the server.
      auth: {},
      reattachInProcess: false,
      thinkingLevel: "off",
      extensionFactories: options.onPiMessageEnd || options.consumePiContinuationInput ? [(pi) => {
        // continueStream resumes Pi with an empty input. Its official input hook
        // submits the current follow-up as a native user message before execution.
        if (options.consumePiContinuationInput) pi.on("input", (event) => {
          if (event.text !== "") return { action: "continue" };
          const text = options.consumePiContinuationInput!();
          return text === undefined ? { action: "continue" } : { action: "transform", text };
        });
        // Observe the native result: harness-pi 1.0.151 normalizes length to stop.
        if (options.onPiMessageEnd) pi.on("message_end", (event) => {
          if (event.message.role !== "assistant") return;
          options.onPiMessageEnd!({
            finishReason: event.message.stopReason,
            outputTokens: event.message.usage.output,
            reasoningTokens: event.message.usage.reasoning ?? 0,
          });
        });
      }] : undefined,
      providers: {
        [provider]: {
          baseUrl: openRouterKey
            ? value(env, "OPENROUTER_BASE_URL") ||
              "https://openrouter.ai/api/v1"
            : directBase!,
          apiKey: openRouterKey || directKey!,
          authHeader: true,
          api: "openai-completions",
          models: [
            {
              id: modelId,
              name: modelId,
              input: ["text"],
              reasoning: options.piModel?.reasoning ?? false,
              contextWindow: options.piModel?.contextWindow ?? (Number(env.PI_CONTEXT_WINDOW) || 32768),
              maxTokens: options.piModel?.maxTokens ?? (Number(env.PI_MAX_OUTPUT_TOKENS) || DEFAULT_PI_OUTPUT_TOKENS),
              // Dynamic OpenRouter routes skip Pi's model.reasoning branch;
              // pass the official provider sampling setting explicitly.
              ...(openRouterKey ? { samplingParams: { reasoning: { enabled: false, effort: "none" } } } : {}),
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    });
    model = `${provider}/${modelId}`;
  } else if (options.harness === "codex") {
    const key = value(env, "OPENAI_API_KEY") || value(env, "CODEX_API_KEY");
    if (!key)
      throw new HTTPException(503, {
        message:
          "原生 Codex 需要 OPENAI_API_KEY 或 CODEX_API_KEY，并按 Responses 协议配置；当前适配器不会自动复用 OPENROUTER_API_KEY",
      });
    const base = value(env, "OPENAI_BASE_URL") || value(env, "CODEX_BASE_URL");
    harness = createCodex({
      auth: { OPENAI_API_KEY: key, ...(base ? { OPENAI_BASE_URL: base } : {}) },
    });
    model = options.modelId?.trim() || value(env, "CODEX_MODEL");
    if (model === "openrouter/free" || model === "openrouter/auto")
      throw new HTTPException(400, {
        message: "Codex 需要原生模型 ID，请重新设置智能体模型",
      });
  } else {
    const key = value(env, "ANTHROPIC_API_KEY") || value(env, "CLAUDE_API_KEY");
    if (!key)
      throw new HTTPException(503, {
        message:
          "原生 Claude Code 需要 ANTHROPIC_API_KEY 或 CLAUDE_API_KEY；请配置 Anthropic Messages 协议提供商",
      });
    const base = value(env, "ANTHROPIC_BASE_URL");
    harness = createClaudeCode({
      auth: {
        ANTHROPIC_API_KEY: key,
        ...(base ? { ANTHROPIC_BASE_URL: base } : {}),
      },
    });
    model = options.modelId?.trim() || value(env, "CLAUDE_MODEL");
    if (model === "openrouter/free" || model === "openrouter/auto")
      throw new HTTPException(400, {
        message: "Claude Code 需要原生模型 ID，请重新设置智能体模型",
      });
  }

  const document =
    options.agentsDocument?.trim() ||
    "# AGENTS.md\n\n遵循 tabdo 工作区权限，使用实际工具验证结果，再向用户报告完成情况。";
  return new HarnessAgent<HarnessV1, ToolSet>({
    ...options.lifecycle,
    harness,
    model,
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
    const fs = await restoreWorkspace(options.workspace);
    const sandbox = await createJustBashNetworkSandboxSession({
      fs,
      cwd: "/workspace",
      env: {},
      sandboxId: options.sandboxId,
      abortSignal: options.signal,
    });
    return { sandbox, fs };
  }
  const credentials = sandboxCredentials(options.env ?? process.env);
  const sandbox = options.hasResumeState
    ? await resumeVercelNetworkSandboxSession({
        ...credentials,
        sandboxId: options.sandboxId,
        abortSignal: options.signal,
      })
    : await createVercelNetworkSandboxSession({
        ...credentials,
        sandboxId: options.sandboxId,
        runtime: "node24",
        ports: [4000],
        template: await options.agent.getSandboxTemplate(),
        abortSignal: options.signal,
      });
  return { sandbox };
}
