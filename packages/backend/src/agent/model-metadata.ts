import { ServiceError } from "../errors.js";
import { z } from "zod";

import { DEFAULT_PI_OUTPUT_TOKENS, isKnownDeepSeekReasoningModel, type PiModelMetadata } from "./model-contracts.js";
import type { RuntimeEnvironment } from "./contracts.js";
export { DEFAULT_PI_OUTPUT_TOKENS, isKnownDeepSeekReasoningModel, type PiModelMetadata, type PiCompletion } from "./model-contracts.js";
import { resolvePiThinkingLevel, resolvePiProvider } from "./runtime-configuration.js";
const catalog = z.object({ data: z.array(z.object({ id: z.string(), context_length: z.number().int().positive(),
  top_provider: z.object({ max_completion_tokens: z.number().int().positive().nullable().optional() }).nullable().optional(),
  supported_parameters: z.array(z.string()).optional(),
})) });
const cache = new Map<string, { expires: number; value: PiModelMetadata }>();
const CATALOG_TIMEOUT_MS = 2_000;

function configuredLimit(env: RuntimeEnvironment, name: string, fallback: number) {
  if (!env[name]) return fallback;
  const value = Number(env[name]);
  if (!Number.isInteger(value) || value < 1 || value > 4_000_000) throw new ServiceError(503, { message: `${name} 必须是正整数 token 上限` });
  return value;
}

/** Pi must receive real model limits: an invented 32k window clamps long prompts to one token. */
export async function resolvePiModelMetadata(modelId: string | undefined, env: RuntimeEnvironment): Promise<PiModelMetadata> {
  const level = resolvePiThinkingLevel(env);
  const provider = resolvePiProvider(env);
  if (provider?.provider !== "openrouter") return {
    contextWindow: configuredLimit(env, "PI_CONTEXT_WINDOW", 32768),
    maxTokens: configuredLimit(env, "PI_MAX_OUTPUT_TOKENS", DEFAULT_PI_OUTPUT_TOKENS),
    reasoning: isKnownDeepSeekReasoningModel(env.PI_BASE_URL?.trim(), modelId?.trim() || env.PI_MODEL?.trim()) || (level !== undefined && level !== "off"),
  };
  const id = modelId?.trim() || provider.defaultModel!;
  const base = provider.baseUrl.replace(/\/$/, "");
  const outputLimit = configuredLimit(env, "PI_MAX_OUTPUT_TOKENS", DEFAULT_PI_OUTPUT_TOKENS);
  const fallback = (): PiModelMetadata => ({
    contextWindow: configuredLimit(env, "PI_CONTEXT_WINDOW", 32768),
    maxTokens: outputLimit, reasoning: false,
  });
  const key = `${base}:${id}:${outputLimit}`, saved = cache.get(key);
  if (saved && saved.expires > Date.now()) return saved.value;
  try {
    const response = await fetch(`${base}/models`, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`模型目录返回 HTTP ${response.status}`);
    const models = catalog.parse(await response.json());
    const model = models.data.find((model) => model.id === id);
    // A directory can omit routed, private, or newly available models. The
    // native provider remains authoritative for whether this ID can execute.
    if (!model) return saved?.value ?? fallback();
    const value: PiModelMetadata = {
      contextWindow: model.context_length,
      maxTokens: Math.min(outputLimit, model.top_provider?.max_completion_tokens ?? outputLimit),
      // Dynamic routers cannot promise one reasoning model across calls.
      reasoning: !id.startsWith("openrouter/") && Boolean(model.supported_parameters?.some((parameter) => parameter === "reasoning" || parameter === "reasoning_effort")),
    };
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(key, { value, expires: Date.now() + 300_000 });
    return value;
  } catch {
    // Catalog availability is advisory. Keep a known model's actual limits,
    // even past the refresh TTL; do not cache guessed limits as catalog data.
    return saved?.value ?? fallback();
  }
}
