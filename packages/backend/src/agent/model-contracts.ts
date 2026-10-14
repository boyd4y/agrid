export type PiModelMetadata = { contextWindow: number; maxTokens: number; reasoning: boolean };
export const DEFAULT_PI_OUTPUT_TOKENS = 16384;
export type PiCompletion = { finishReason: string; outputTokens: number; reasoningTokens: number };
