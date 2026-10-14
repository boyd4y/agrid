import { HTTPException } from "hono/http-exception";
import { HarnessConfigurationError } from "@tabdo/core/harness";
import { DEFAULT_PI_OUTPUT_TOKENS, type PiModelMetadata } from "./model-contracts.js";
import type { HarnessId, RuntimeMode, RuntimeEnvironment } from "./contracts.js";

/** Validated product settings only; official SDK assembly belongs to the execution environment. */
export type PiProviderConfiguration = {
  providerId: string;
  apiKey: string;
  baseUrl: string;
  model: { id: string; contextWindow: number; maxTokens: number; reasoning: boolean };
  maxTokensField: "max_tokens" | "max_completion_tokens";
  samplingParams?: Record<string, unknown>;
  reattachInProcess: boolean;
};

export type NativeConfiguration =
  | { harness: "pi"; mode: RuntimeMode; adapter: PiProviderConfiguration }
  | { harness: "codex" | "claude"; mode: RuntimeMode; adapter: { apiKey: string; baseUrl?: string; model?: string } };

const value = (env: RuntimeEnvironment, name: string) =>
  env[name]?.trim() || undefined;

export function sandboxCredentials(env: RuntimeEnvironment) {
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

/** Validate product configuration without loading or constructing a native SDK. */
export function resolveNativeConfiguration(options: { harness: HarnessId; mode: RuntimeMode; modelId?: string; piModel?: PiModelMetadata; env: RuntimeEnvironment }): NativeConfiguration {
  const env = options.env;
  if (options.mode === "local" && options.harness !== "pi")
    throw new HTTPException(400, {
      message:
        "本地模式目前支持 Pi；Codex 和 Claude Code 需要可暴露端口的 Sandbox 模式",
    });
  if (options.mode === "sandbox") sandboxCredentials(env);

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
    const contextWindow = options.piModel?.contextWindow ?? (Number(env.PI_CONTEXT_WINDOW) || 32768);
    for (const limit of [maxTokens, contextWindow]) if (!Number.isSafeInteger(limit) || limit < 1) throw new HarnessConfigurationError("Invalid model token limits");
    const maxTokensField = openRouterKey ? "max_tokens" : "max_completion_tokens";
    return { harness: "pi", mode: options.mode, adapter: {
      providerId: provider,
      baseUrl: openRouterKey ? value(env, "OPENROUTER_BASE_URL") || "https://openrouter.ai/api/v1" : directBase!,
      apiKey: openRouterKey || directKey!,
      model: { id: modelId, reasoning: options.piModel?.reasoning ?? false,
        contextWindow, maxTokens },
      maxTokensField,
      samplingParams: openRouterKey ? { reasoning: { enabled: false, effort: "none" } } : undefined,
      // Current warm-session behavior is preserved until platform cold resume is wired.
      reattachInProcess: true,
    } };
  } else if (options.harness === "codex") {
    const key = value(env, "OPENAI_API_KEY") || value(env, "CODEX_API_KEY");
    if (!key)
      throw new HTTPException(503, {
        message:
          "原生 Codex 需要 OPENAI_API_KEY 或 CODEX_API_KEY，并按 Responses 协议配置；当前适配器不会自动复用 OPENROUTER_API_KEY",
      });
    const base = value(env, "OPENAI_BASE_URL") || value(env, "CODEX_BASE_URL");
    const model = options.modelId?.trim() || value(env, "CODEX_MODEL");
    if (model === "openrouter/free" || model === "openrouter/auto")
      throw new HTTPException(400, {
        message: "Codex 需要原生模型 ID，请重新设置智能体模型",
      });
    return { harness: "codex", mode: options.mode, adapter: { apiKey: key, baseUrl: base, model } };
  } else {
    const key = value(env, "ANTHROPIC_API_KEY") || value(env, "CLAUDE_API_KEY");
    if (!key)
      throw new HTTPException(503, {
        message:
          "原生 Claude Code 需要 ANTHROPIC_API_KEY 或 CLAUDE_API_KEY；请配置 Anthropic Messages 协议提供商",
      });
    const base = value(env, "ANTHROPIC_BASE_URL");
    const model = options.modelId?.trim() || value(env, "CLAUDE_MODEL");
    if (model === "openrouter/free" || model === "openrouter/auto")
      throw new HTTPException(400, {
        message: "Claude Code 需要原生模型 ID，请重新设置智能体模型",
      });
    return { harness: "claude", mode: options.mode, adapter: { apiKey: key, baseUrl: base, model } };
  }
}
