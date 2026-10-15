export type PiModelMetadata = { contextWindow: number; maxTokens: number; reasoning: boolean };
export const DEFAULT_PI_OUTPUT_TOKENS = 16384;
export type PiCompletion = { finishReason: string; outputTokens: number; reasoningTokens: number };

/** Native Pi SDK levels; keep optional so its session/model default can apply. */
export const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type PiThinkingLevel = typeof PI_THINKING_LEVELS[number];

export function isDeepSeekEndpoint(baseUrl: string | undefined): boolean {
  try { return Boolean(baseUrl && new URL(baseUrl).hostname === "api.deepseek.com"); } catch { return false; }
}

/** Only documented model IDs are inferred; custom endpoints remain explicit. */
export function isKnownDeepSeekReasoningModel(baseUrl: string | undefined, modelId: string | undefined): boolean {
  return isDeepSeekEndpoint(baseUrl) && ["deepseek-flash", "deepseek-v4-pro", "deepseek-reasoner"].includes(modelId ?? "");
}
