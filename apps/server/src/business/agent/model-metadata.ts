import { ServiceError } from "../errors.js";
import { DEFAULT_PI_OUTPUT_TOKENS, isKnownDeepSeekReasoningModel, type PiModelMetadata } from "./model-contracts.js";
import type { RuntimeEnvironment } from "./contracts.js";
import { resolvePiThinkingLevel, resolvePiModelId } from "./runtime-configuration.js";
export { DEFAULT_PI_OUTPUT_TOKENS, isKnownDeepSeekReasoningModel, type PiModelMetadata, type PiCompletion } from "./model-contracts.js";

function configuredLimit(env: RuntimeEnvironment, name: string, fallback: number) {
  if (!env[name]) return fallback;
  const value = Number(env[name]);
  if (!Number.isInteger(value) || value < 1 || value > 4_000_000) throw new ServiceError(503, { message: `${name} 必须是正整数 token 上限` });
  return value;
}

/** Direct endpoints use explicit limits; preparing a turn never fetches a model catalog. */
export async function resolvePiModelMetadata(modelId: string | undefined, env: RuntimeEnvironment): Promise<PiModelMetadata> {
  const level = resolvePiThinkingLevel(env);
  const resolvedModel = resolvePiModelId(modelId, env);
  return {
    contextWindow: configuredLimit(env, "PI_CONTEXT_WINDOW", 32768),
    maxTokens: configuredLimit(env, "PI_MAX_OUTPUT_TOKENS", DEFAULT_PI_OUTPUT_TOKENS),
    reasoning: isKnownDeepSeekReasoningModel(env.PI_BASE_URL?.trim(), resolvedModel) || (level !== undefined && level !== "off"),
  };
}
