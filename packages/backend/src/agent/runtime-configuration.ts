import { ServiceError } from "../errors.js";
import { HarnessConfigurationError } from "./contracts.js";
import { DEFAULT_PI_OUTPUT_TOKENS, PI_THINKING_LEVELS, isDeepSeekEndpoint, isKnownDeepSeekReasoningModel, type PiThinkingLevel, type PiModelMetadata } from "./model-contracts.js";
import { NATIVE_DEFAULT_MODEL, type HarnessId, type RuntimeMode, type RuntimeEnvironment } from "./contracts.js";

/** Validated product settings only; official SDK assembly belongs to the execution environment. */
export type PiProviderConfiguration = {
  providerId: string;
  apiKey: string;
  baseUrl: string;
  model: { id: string; contextWindow: number; maxTokens: number; reasoning: boolean };
  maxTokensField: "max_tokens" | "max_completion_tokens";
  samplingParams?: Record<string, unknown>;
  reattachInProcess: boolean;
  thinkingLevel?: PiThinkingLevel;
};

export type NativeConfiguration =
  | { harness: "pi"; mode: RuntimeMode; adapter: PiProviderConfiguration }
  | { harness: "codex" | "claude"; mode: RuntimeMode; adapter: { apiKey: string; baseUrl?: string; model?: string } };

const value = (env: RuntimeEnvironment, name: string) =>
  env[name]?.trim() || undefined;

/** Select a complete provider as one unit; never mix one provider's model with another's credentials. */
export function resolvePiProvider(env: RuntimeEnvironment): {
  provider: "pi" | "openrouter"; providerId: string; apiKey: string; baseUrl: string; defaultModel: string | undefined;
} | undefined {
  const key = value(env, "PI_API_KEY"), base = value(env, "PI_BASE_URL");
  if (key && base) return { provider: "pi", providerId: "tabdo-pi", apiKey: key, baseUrl: base, defaultModel: value(env, "PI_MODEL") };
  const openRouter = value(env, "OPENROUTER_API_KEY");
  if (openRouter) return { provider: "openrouter", providerId: "openrouter", apiKey: openRouter,
    baseUrl: value(env, "OPENROUTER_BASE_URL") || "https://openrouter.ai/api/v1", defaultModel: value(env, "OPENROUTER_MODEL") || "openrouter/free" };
  return undefined;
}

/** Old product defaults are router aliases, not model IDs on a direct endpoint. */
export function resolvePiModelId(modelId: string | undefined, env: RuntimeEnvironment): string | undefined {
  const provider = resolvePiProvider(env);
  const selected = modelId?.trim();
  const requested = selected === NATIVE_DEFAULT_MODEL ? undefined : selected;
  if (provider?.provider === "pi" && ["openrouter/free", "openrouter/auto"].includes(requested ?? "")) {
    if (!provider.defaultModel || provider.defaultModel.startsWith("openrouter/"))
      throw new ServiceError(400, { message: "智能体保存了旧 OpenRouter 默认模型，请配置 PI_MODEL 或选择当前提供商的模型" });
    return provider.defaultModel;
  }
  return requested || provider?.defaultModel;
}

export function resolvePiThinkingLevel(env: RuntimeEnvironment): PiThinkingLevel | undefined {
  const level = value(env, "PI_THINKING_LEVEL");
  if (level === undefined) return undefined;
  if (!(PI_THINKING_LEVELS as readonly string[]).includes(level)) throw new ServiceError(503, {
    message: `PI_THINKING_LEVEL 必须是 ${PI_THINKING_LEVELS.join(" / ")}`,
  });
  return level as PiThinkingLevel;
}

/** Validate product configuration without loading or constructing a native SDK. */
export function resolveNativeConfiguration(options: { harness: HarnessId; mode: RuntimeMode; modelId?: string; piModel?: PiModelMetadata; env: RuntimeEnvironment }): NativeConfiguration {
  const env = options.env;
  if (options.mode === "local" && options.harness !== "pi")
    throw new ServiceError(400, {
      message:
        "本地模式目前支持 Pi；Codex 和 Claude Code 需要可暴露端口的 Sandbox 模式",
    });


  if (options.harness === "pi") {
    const provider = resolvePiProvider(env);
    if (!provider)
      throw new ServiceError(503, {
        message:
          "Pi 未配置模型提供商：请设置 OPENROUTER_API_KEY，或 PI_API_KEY 与 PI_BASE_URL",
      });
    const openRouter = provider.provider === "openrouter";
    const modelId = resolvePiModelId(options.modelId, env);
    if (!modelId)
      throw new ServiceError(400, {
        message: "自定义 Pi 提供商需要配置模型 ID",
      });
    const maxTokens = options.piModel?.maxTokens ?? (Number(env.PI_MAX_OUTPUT_TOKENS) || DEFAULT_PI_OUTPUT_TOKENS);
    const contextWindow = options.piModel?.contextWindow ?? (Number(env.PI_CONTEXT_WINDOW) || 32768);
    for (const limit of [maxTokens, contextWindow]) if (!Number.isSafeInteger(limit) || limit < 1) throw new HarnessConfigurationError("Invalid model token limits");
    const thinkingLevel = resolvePiThinkingLevel(env);
    const deepSeekDirect = !openRouter && isDeepSeekEndpoint(provider.baseUrl);
    const reasoning = options.piModel?.reasoning ?? ((!openRouter && isKnownDeepSeekReasoningModel(provider.baseUrl, modelId))
      || (thinkingLevel !== undefined && thinkingLevel !== "off"));
    const maxTokensField = openRouter || deepSeekDirect ? "max_tokens" : "max_completion_tokens";
    return { harness: "pi", mode: options.mode, adapter: {
      providerId: provider.providerId,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: { id: modelId, reasoning,
        contextWindow, maxTokens },
      maxTokensField,
      thinkingLevel,
      // Preserve native defaults. Only an explicit off setting disables thinking.
      samplingParams: thinkingLevel !== "off" ? undefined : openRouter ? { reasoning: { enabled: false, effort: "none" } }
        : deepSeekDirect ? { thinking: { type: "disabled" } } : undefined,
      // Current warm-session behavior is preserved until platform cold resume is wired.
      reattachInProcess: true,
    } };
  } else if (options.harness === "codex") {
    const key = value(env, "OPENAI_API_KEY") || value(env, "CODEX_API_KEY");
    if (!key)
      throw new ServiceError(503, {
        message:
          "原生 Codex 需要 OPENAI_API_KEY 或 CODEX_API_KEY，并按 Responses 协议配置；当前适配器不会自动复用 OPENROUTER_API_KEY",
      });
    const base = value(env, "OPENAI_BASE_URL") || value(env, "CODEX_BASE_URL");
    const model = options.modelId?.trim() || value(env, "CODEX_MODEL");
    if (model === "openrouter/free" || model === "openrouter/auto")
      throw new ServiceError(400, {
        message: "Codex 需要原生模型 ID，请重新设置智能体模型",
      });
    return { harness: "codex", mode: options.mode, adapter: { apiKey: key, baseUrl: base, model } };
  } else {
    const key = value(env, "ANTHROPIC_API_KEY") || value(env, "CLAUDE_API_KEY");
    if (!key)
      throw new ServiceError(503, {
        message:
          "原生 Claude Code 需要 ANTHROPIC_API_KEY 或 CLAUDE_API_KEY；请配置 Anthropic Messages 协议提供商",
      });
    const base = value(env, "ANTHROPIC_BASE_URL");
    const model = options.modelId?.trim() || value(env, "CLAUDE_MODEL");
    if (model === "openrouter/free" || model === "openrouter/auto")
      throw new ServiceError(400, {
        message: "Claude Code 需要原生模型 ID，请重新设置智能体模型",
      });
    return { harness: "claude", mode: options.mode, adapter: { apiKey: key, baseUrl: base, model } };
  }
}
